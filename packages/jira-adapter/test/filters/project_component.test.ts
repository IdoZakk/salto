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
import { CORE_ANNOTATIONS, ElemID, InstanceElement, ObjectType, ReferenceExpression, toChange } from '@salto-io/adapter-api'
import { filterUtils, client as clientUtils, deployment, elements as elementUtils } from '@salto-io/adapter-components'
import { buildElementsSourceFromElements } from '@salto-io/adapter-utils'
import { DEFAULT_CONFIG } from '../../src/config'
import JiraClient from '../../src/client/client'
import { JIRA } from '../../src/constants'
import projectComponentFilter from '../../src/filters/project_component'
import { mockClient } from '../utils'

jest.mock('@salto-io/adapter-components', () => {
  const actual = jest.requireActual('@salto-io/adapter-components')
  return {
    ...actual,
    deployment: {
      ...actual.deployment,
      deployChange: jest.fn(),
    },
  }
})

describe('projectComponentFilter', () => {
  let filter: filterUtils.FilterWith<'onFetch' | 'preDeploy' | 'deploy' | 'onDeploy'>
  let instance: InstanceElement
  let client: JiraClient
  let type: ObjectType
  const deployChangeMock = deployment.deployChange as jest.MockedFunction<
    typeof deployment.deployChange
  >

  beforeEach(async () => {
    const { client: cli, paginator } = mockClient()
    client = cli

    filter = projectComponentFilter({
      client,
      paginator,
      config: DEFAULT_CONFIG,
      elementsSource: buildElementsSourceFromElements([]),
      fetchQuery: elementUtils.query.createMockQuery(),
    }) as typeof filter

    type = new ObjectType({
      elemID: new ElemID(JIRA, 'ProjectComponent'),
    })

    instance = new InstanceElement(
      'instance',
      type,
    )
  })

  describe('onFetch', () => {
    it('should add leadAccountId', async () => {
      instance.value = {
        lead: {
          accountId: '1',
        },
      }
      await filter.onFetch([type, instance])
      expect(instance.value).toEqual({
        leadAccountId: '1',
      })
    })

    it('should do nothing if there is not leadAccountId', async () => {
      instance.value = {
        other: 'other',
      }
      await filter.onFetch([type, instance])
      expect(instance.value).toEqual({
        other: 'other',
      })
    })
  })

  describe('deploy', () => {
    it('should ignore instance not being exist error on removal', async () => {
      instance.value.id = '1'
      deployChangeMock.mockImplementation(async () => {
        throw new clientUtils.HTTPError('message', {
          status: 404,
          data: {
            errorMessages: ['The component with id 1 does not exist.'],
          },
        })
      })
      const change = toChange({ before: instance })
      const res = await filter.deploy([change])

      expect(res.deployResult.errors).toHaveLength(0)
    })

    it('should throw for other errors', async () => {
      instance.value.id = '1'
      deployChangeMock.mockImplementation(async () => {
        throw new clientUtils.HTTPError('message', {
          status: 404,
          data: {
            errorMessages: ['Other'],
          },
        })
      })
      const change = toChange({ before: instance })
      const res = await filter.deploy([change])

      expect(res.deployResult.errors).toHaveLength(1)
    })
  })

  describe('preDeploy', () => {
    it('should add project value', async () => {
      instance.annotations[CORE_ANNOTATIONS.PARENT] = [
        new ReferenceExpression(
          new ElemID(JIRA, 'Project', 'instance', 'parent'),
          {
            value: {
              key: 'projectKey',
            },
          }
        ),
      ]
      await filter.preDeploy([toChange({ after: instance })])
      expect(instance.value.project).toEqual('projectKey')
    })

    it('should do nothing if there is no parent', async () => {
      await filter.preDeploy([toChange({ after: instance })])
      expect(instance.value.project).toBeUndefined()
    })
  })

  describe('onDeploy', () => {
    it('should convert the id to string', async () => {
      instance.value.project = 'key'
      await filter.onDeploy([toChange({ after: instance })])
      expect(instance.value.project).toBeUndefined()
    })
  })
})
