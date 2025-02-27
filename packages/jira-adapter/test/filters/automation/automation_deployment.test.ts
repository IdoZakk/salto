/*
*                      Copyright 2022 Salto Labs Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with
* the License.  You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
import { ElemID, InstanceElement, ObjectType, CORE_ANNOTATIONS, BuiltinTypes, Values, toChange } from '@salto-io/adapter-api'
import _ from 'lodash'
import { buildElementsSourceFromElements, safeJsonStringify } from '@salto-io/adapter-utils'
import { filterUtils, client as clientUtils, elements as elementUtils } from '@salto-io/adapter-components'
import { MockInterface } from '@salto-io/test-utils'
import { mockClient } from '../../utils'
import automationDeploymentFilter from '../../../src/filters/automation/automation_deployment'
import { DEFAULT_CONFIG, JiraConfig } from '../../../src/config'
import { AUTOMATION_TYPE, JIRA } from '../../../src/constants'
import JiraClient, { PRIVATE_API_HEADERS } from '../../../src/client/client'
import { CLOUD_RESOURCE_FIELD } from '../../../src/filters/automation/cloud_id'

describe('automationDeploymentFilter', () => {
  let filter: filterUtils.FilterWith<'onFetch' | 'deploy'>
  let type: ObjectType
  let instance: InstanceElement
  let config: JiraConfig
  let client: JiraClient
  let connection: MockInterface<clientUtils.APIConnection>


  beforeEach(async () => {
    const { client: cli, paginator, connection: conn } = mockClient()
    client = cli
    connection = conn

    config = _.cloneDeep(DEFAULT_CONFIG)
    filter = automationDeploymentFilter({
      client,
      paginator,
      config,
      elementsSource: buildElementsSourceFromElements([]),
      fetchQuery: elementUtils.query.createMockQuery(),
    }) as filterUtils.FilterWith<'onFetch' | 'deploy'>

    type = new ObjectType({
      elemID: new ElemID(JIRA, AUTOMATION_TYPE),
      fields: {
        name: {
          refType: BuiltinTypes.STRING,
        },
      },
    })

    instance = new InstanceElement(
      'instance',
      type,
      {
        name: 'someName',
        state: 'ENABLED',
        projects: [
          {
            projectId: '1',
          },
        ],
      }
    )
  })

  describe('onFetch', () => {
    it('should add deployment annotations', async () => {
      await filter.onFetch([type])

      expect(type.annotations).toEqual({
        [CORE_ANNOTATIONS.CREATABLE]: true,
        [CORE_ANNOTATIONS.UPDATABLE]: true,
        [CORE_ANNOTATIONS.DELETABLE]: true,
      })

      expect(type.fields.name.annotations).toEqual({
        [CORE_ANNOTATIONS.CREATABLE]: true,
        [CORE_ANNOTATIONS.UPDATABLE]: true,
      })
    })

    it('should not add deployment annotations if usePrivateAPI is false', async () => {
      config.client.usePrivateAPI = false

      await filter.onFetch([type])

      expect(type.annotations).toEqual({})
      expect(type.fields.name.annotations).toEqual({})
    })

    it('should not add deployment annotations if type not found', async () => {
      await filter.onFetch([])
      expect(type.annotations).toEqual({})
      expect(type.fields.name.annotations).toEqual({})
    })
  })

  describe('deploy', () => {
    let existingAutomationValues: Values

    beforeEach(() => {
      existingAutomationValues = {
        name: 'existingAutomation',
        id: 2,
        created: 2,
        projects: [],
      }

      connection.post.mockImplementation(async url => {
        if (url === '/rest/webResources/1.0/resources') {
          return {
            status: 200,
            data: {
              unparsedData: {
                [CLOUD_RESOURCE_FIELD]: safeJsonStringify({
                  tenantId: 'cloudId',
                }),
              },
            },
          }
        }

        if (url === '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import') {
          return {
            status: 200,
            data: null,
          }
        }

        if (url === '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rules') {
          return {
            status: 200,
            data: {
              total: 2,
              values: [
                existingAutomationValues,
                {
                  name: 'someName',
                  id: 3,
                  created: 1,
                  projects: [
                    {
                      projectId: '1',
                    },
                  ],
                },
              ],
            },
          }
        }
        throw new Error(`Unexpected url ${url}`)
      })
    })

    it('should create automation', async () => {
      await filter.deploy([toChange({ after: instance })])

      expect(instance.value.id).toBe(3)
      expect(instance.value.created).toBe(1)

      expect(connection.post).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import',
        {
          rules: [{
            name: 'someName',
            state: 'ENABLED',
            projects: [
              {
                projectId: '1',
              },
            ],
            ruleScope: {
              resources: [
                'ari:cloud:jira:cloudId:project/1',
              ],
            },
          }],
        },
        {
          headers: PRIVATE_API_HEADERS,
        }
      )

      expect(connection.put).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/3',
        {
          ruleConfigBean: {
            id: 3,
            created: 1,
            name: 'someName',
            state: 'ENABLED',
            projects: [
              {
                projectId: '1',
              },
            ],
            ruleScope: {
              resources: [
                'ari:cloud:jira:cloudId:project/1',
              ],
            },
          },
        },
        {
          headers: PRIVATE_API_HEADERS,
        }
      )
    })

    it('should not call enable automation if it is disabled', async () => {
      instance.value.state = 'DISABLED'
      await filter.deploy([toChange({ after: instance })])

      expect(instance.value.id).toBe(3)

      expect(connection.post).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import',
        {
          rules: [{
            name: 'someName',
            state: 'DISABLED',
            projects: [
              {
                projectId: '1',
              },
            ],
            ruleScope: {
              resources: [
                'ari:cloud:jira:cloudId:project/1',
              ],
            },
          }],
        },
        {
          headers: PRIVATE_API_HEADERS,
        }
      )

      expect(connection.put).not.toHaveBeenCalled()
    })

    it('should deploy automation of all projects', async () => {
      delete instance.value.projects
      await filter.deploy([toChange({ after: instance })])

      expect(connection.post).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import',
        {
          rules: [{
            name: 'someName',
            state: 'ENABLED',
            ruleScope: {
              resources: [
                'ari:cloud:jira::site/cloudId',
              ],
            },
          }],
        },
        {
          headers: PRIVATE_API_HEADERS,
        }
      )
    })

    it('should deploy automation of projects type', async () => {
      instance.value.projects = [{
        projectTypeKey: 'business',
      }]
      await filter.deploy([toChange({ after: instance })])

      expect(connection.post).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import',
        {
          rules: [{
            name: 'someName',
            state: 'ENABLED',
            projects: [{
              projectTypeKey: 'business',
            }],
            ruleScope: {
              resources: [
                'ari:cloud:jira-core::site/cloudId',
              ],
            },
          }],
        },
        {
          headers: PRIVATE_API_HEADERS,
        }
      )
    })

    it('should throw if received invalid response from import', async () => {
      connection.post.mockImplementation(async url => {
        if (url === '/rest/webResources/1.0/resources') {
          return {
            status: 200,
            data: {
              unparsedData: {
                [CLOUD_RESOURCE_FIELD]: safeJsonStringify({
                  tenantId: 'cloudId',
                }),
              },
            },
          }
        }

        if (url === '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import') {
          return {
            status: 200,
            data: [
              existingAutomationValues,
              {
              },
            ],
          }
        }
        throw new Error(`Unexpected url ${url}`)
      })
      const { deployResult } = await filter.deploy([toChange({ after: instance })])
      expect(deployResult.errors).toHaveLength(1)
    })

    it('should throw if received more than one identical automation in response', async () => {
      connection.post.mockImplementation(async url => {
        if (url === '/rest/webResources/1.0/resources') {
          return {
            status: 200,
            data: {
              unparsedData: {
                [CLOUD_RESOURCE_FIELD]: safeJsonStringify({
                  tenantId: 'cloudId',
                }),
              },
            },
          }
        }

        if (url === '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/import') {
          return {
            status: 200,
            data: [
              existingAutomationValues,
              {
                name: 'someName',
                id: 3,
                created: 1,
                projects: [
                  {
                    projectId: '1',
                  },
                ],
              },
              {
                name: 'someName',
                id: 4,
                created: 1,
                projects: [
                  {
                    projectId: '1',
                  },
                ],
              },
            ],
          }
        }
        throw new Error(`Unexpected url ${url}`)
      })
      const { deployResult } = await filter.deploy([toChange({ after: instance })])
      expect(deployResult.errors).toHaveLength(1)
    })

    it('should delete automation', async () => {
      instance.value.id = 3
      await filter.deploy([toChange({ before: instance })])

      expect(connection.delete).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/3',
        {
          headers: PRIVATE_API_HEADERS,
        }
      )
    })

    it('should modify automation', async () => {
      instance.value.id = 3
      instance.value.created = 1
      await filter.deploy([toChange({ before: instance, after: instance })])

      expect(connection.put).toHaveBeenCalledWith(
        '/gateway/api/automation/internal-api/jira/cloudId/pro/rest/GLOBAL/rule/3',
        {
          ruleConfigBean: {
            id: 3,
            created: 1,
            name: 'someName',
            state: 'ENABLED',
            projects: [
              {
                projectId: '1',
              },
            ],
            ruleScope: {
              resources: [
                'ari:cloud:jira:cloudId:project/1',
              ],
            },
          },
        },
        {
          headers: PRIVATE_API_HEADERS,
        }
      )
    })
  })
})
