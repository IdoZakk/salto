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
import { AdapterOperations, ObjectType, ElemID, ProgressReporter, FetchResult, InstanceElement, toChange, isRemovalChange, getChangeData, BuiltinTypes, ReferenceExpression, ElemIdGetter, ServiceIds } from '@salto-io/adapter-api'
import { deployment, elements, client } from '@salto-io/adapter-components'
import { buildElementsSourceFromElements } from '@salto-io/adapter-utils'
import { mockFunction } from '@salto-io/test-utils'
import JiraClient from '../src/client/client'
import { adapter as adapterCreator } from '../src/adapter_creator'
import { DEFAULT_CONFIG } from '../src/config'
import { ISSUE_TYPE_NAME, JIRA } from '../src/constants'
import { createCredentialsInstance, createConfigInstance } from './utils'


const { generateTypes, getAllInstances, loadSwagger } = elements.swagger

jest.mock('@salto-io/adapter-components', () => {
  const actual = jest.requireActual('@salto-io/adapter-components')
  // only including relevant functions
  return {
    ...actual,
    deployment: {
      ...actual.deployment,
      changeValidators: actual.deployment.changeValidators,
      deployChange: jest.fn().mockImplementation(actual.elements.swagger.deployChange),
    },
    elements: {
      ...actual.elements,
      swagger: {
        flattenAdditionalProperties: actual.elements.swagger.flattenAdditionalProperties,
        generateTypes: jest.fn().mockImplementation(() => { throw new Error('generateTypes called without a mock') }),
        getAllInstances: jest.fn().mockImplementation(() => { throw new Error('getAllInstances called without a mock') }),
        loadSwagger: jest.fn().mockImplementation(() => { throw new Error('loadSwagger called without a mock') }),
        addDeploymentAnnotations: jest.fn(),
      },
    },
  }
})

describe('adapter', () => {
  let adapter: AdapterOperations
  let getElemIdFunc: ElemIdGetter

  beforeEach(() => {
    const elementsSource = buildElementsSourceFromElements([])
    getElemIdFunc = (adapterName: string, _serviceIds: ServiceIds, name: string): ElemID =>
      new ElemID(adapterName, name)

    const config = createConfigInstance(DEFAULT_CONFIG)
    config.value.client.usePrivateAPI = false

    adapter = adapterCreator.operations({
      elementsSource,
      credentials: createCredentialsInstance({ baseUrl: 'http:/jira.net', user: 'u', token: 't' }),
      config,
      getElemIdFunc,
    })
  })
  describe('deploy', () => {
    const fieldConfigurationIssueTypeItemType = new ObjectType({ elemID: new ElemID(JIRA, 'FieldConfigurationIssueTypeItem'), fields: { issueTypeId: { refType: BuiltinTypes.STRING } } })
    let deployChangeMock: jest.MockedFunction<typeof deployment.deployChange>
    beforeEach(() => {
      deployChangeMock = deployment.deployChange as jest.MockedFunction<
       typeof deployment.deployChange
      >
      deployChangeMock.mockClear()
      deployChangeMock.mockImplementation(async change => {
        if (isRemovalChange(change)) {
          throw new Error('some error')
        }
        return { id: 2 }
      })
    })

    it('should return the applied changes', async () => {
      const deployRes = await adapter.deploy({
        changeGroup: {
          groupID: 'group',
          changes: [
            toChange({ before: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType), after: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType) }),
            toChange({ before: new InstanceElement('inst2', fieldConfigurationIssueTypeItemType) }),
          ],
        },
      })

      expect(deployRes.appliedChanges).toEqual([
        toChange({ before: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType), after: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType) }),
      ])
    })

    it('should call deployChange with the resolved elements', async () => {
      const referencedInstance = new InstanceElement(
        'referenced',
        new ObjectType({
          elemID: new ElemID(JIRA, ISSUE_TYPE_NAME),
          fields: { id: { refType: BuiltinTypes.STRING } },
        }),
        { id: '3' }
      )
      await adapter.deploy({
        changeGroup: {
          groupID: 'group',
          changes: [
            toChange({
              before: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType),
              after: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType, { issueTypeId: new ReferenceExpression(referencedInstance.elemID, referencedInstance) }),
            }),
          ],
        },
      })

      expect(deployChangeMock).toHaveBeenCalledWith(
        toChange({
          before: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType),
          after: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType, { issueTypeId: '3' }),
        }),
        expect.any(JiraClient),
        undefined,
        [],
        undefined,
        undefined,
      )
    })

    it('should return the errors', async () => {
      deployChangeMock.mockImplementation(async change => {
        if (isRemovalChange(change)) {
          throw new Error('some error')
        }
        throw new client.HTTPError('some error', { status: 400, data: { errorMessages: ['errorMessage'], errors: { key: 'value' } } })
      })

      const deployRes = await adapter.deploy({
        changeGroup: {
          groupID: 'group',
          changes: [
            toChange({ after: new InstanceElement('inst1', fieldConfigurationIssueTypeItemType) }),
            toChange({ before: new InstanceElement('inst2', fieldConfigurationIssueTypeItemType) }),
          ],
        },
      })

      expect(deployRes.errors).toEqual([
        new Error('Deployment of jira.FieldConfigurationIssueTypeItem.instance.inst1 failed: Error: some error. errorMessage, {"key":"value"}'),
        new Error('Deployment of jira.FieldConfigurationIssueTypeItem.instance.inst2 failed: Error: some error'),
      ])
    })

    it('should add the new id on addition', async () => {
      const instance = new InstanceElement('instance', new ObjectType({ elemID: new ElemID(JIRA, 'obj') }))
      const { appliedChanges } = await adapter.deploy({
        changeGroup: {
          groupID: 'group',
          changes: [
            toChange({ after: instance }),
          ],
        },
      })

      expect((getChangeData(appliedChanges[0]) as InstanceElement)?.value.id).toEqual(2)
    })
    it('should not add the new id on addition if received an invalid response', async () => {
      deployChangeMock.mockResolvedValue([])
      const instance = new InstanceElement('instance', new ObjectType({ elemID: new ElemID(JIRA, 'obj') }))
      const { appliedChanges } = await adapter.deploy({
        changeGroup: {
          groupID: 'group',
          changes: [
            toChange({ after: instance }),
          ],
        },
      })

      expect((getChangeData(appliedChanges[0]) as InstanceElement)?.value.id).toBeUndefined()
    })
  })
  describe('deployModifiers', () => {
    it('should have change validator', () => {
      expect(adapter.deployModifiers?.changeValidator).toBeDefined()
    })
  })

  describe('fetch', () => {
    let progressReporter: ProgressReporter
    let result: FetchResult
    let platformTestType: ObjectType
    let jiraTestType: ObjectType
    let testInstance: InstanceElement
    beforeEach(async () => {
      progressReporter = {
        reportProgress: mockFunction<ProgressReporter['reportProgress']>(),
      }
      platformTestType = new ObjectType({
        elemID: new ElemID(JIRA, 'platform'),
      })
      jiraTestType = new ObjectType({
        elemID: new ElemID(JIRA, 'jira'),
      })
      testInstance = new InstanceElement('test', jiraTestType);

      (generateTypes as jest.MockedFunction<typeof generateTypes>)
        .mockResolvedValueOnce({
          allTypes: { PlatformTest: platformTestType },
          parsedConfigs: { PlatformTest: { request: { url: 'platform' } } },
        })
        .mockResolvedValueOnce({
          allTypes: { JiraTest: jiraTestType },
          parsedConfigs: { JiraTest: { request: { url: 'jira' } } },
        });

      (getAllInstances as jest.MockedFunction<typeof getAllInstances>)
        .mockResolvedValue([testInstance]);
      (loadSwagger as jest.MockedFunction<typeof loadSwagger>)
        .mockResolvedValue({ document: {}, parser: {} } as elements.swagger.LoadedSwagger)

      result = await adapter.fetch({ progressReporter })
    })
    it('should generate types for the platform and the jira apis', () => {
      expect(loadSwagger).toHaveBeenCalledTimes(2)
      expect(loadSwagger).toHaveBeenCalledWith('https://raw.githubusercontent.com/salto-io/jira-swaggers/main/platform-swagger.v3.json')
      expect(loadSwagger).toHaveBeenCalledWith('https://raw.githubusercontent.com/salto-io/jira-swaggers/main/software-swagger.v3.json')
      expect(generateTypes).toHaveBeenCalledWith(
        JIRA,
        expect.objectContaining({
          swagger: expect.objectContaining({
            url: 'https://raw.githubusercontent.com/salto-io/jira-swaggers/main/platform-swagger.v3.json',
          }),
        }),
        undefined,
        expect.any(Object)
      )
      expect(generateTypes).toHaveBeenCalledWith(
        JIRA,
        expect.objectContaining({
          swagger: expect.objectContaining({
            url: 'https://raw.githubusercontent.com/salto-io/jira-swaggers/main/software-swagger.v3.json',
          }),
        }),
        undefined,
        expect.any(Object)
      )
    })

    it('should pass elem id getter to getAllInstances', () => {
      expect(getAllInstances).toHaveBeenCalledWith(
        expect.objectContaining({
          getElemIdFunc,
        })
      )
    })

    it('should return all types and instances returned from the infrastructure', () => {
      expect(result.elements).toContain(platformTestType)
      expect(result.elements).toContain(jiraTestType)
      expect(result.elements).toContain(testInstance)
    })
  })
})
