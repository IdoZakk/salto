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
import { ObjectType, ElemID, InstanceElement, CORE_ANNOTATIONS, toChange, getChangeData } from '@salto-io/adapter-api'
import { client as clientUtils, filterUtils, elements as elementUtils } from '@salto-io/adapter-components'
import { buildElementsSourceFromElements } from '@salto-io/adapter-utils'
import { mockClient } from '../../utils'
import { DEFAULT_CONFIG } from '../../../src/config'
import JiraClient from '../../../src/client/client'
import { JIRA } from '../../../src/constants'
import filterCreator from '../../../src/filters/service_url/service_url'

describe('service url filter', () => {
  let client: JiraClient
  let paginator: clientUtils.Paginator
  type FilterType = filterUtils.FilterWith<'onFetch' | 'onDeploy'>
  let filter: FilterType
  const screenObjType = new ObjectType({ elemID: new ElemID(JIRA, 'Screen') })
  const screenInst = new InstanceElement('Screen', screenObjType, { id: 11 })
  const testObjType = new ObjectType({ elemID: new ElemID(JIRA, 'test') })
  const testInst = new InstanceElement('test', testObjType, { id: 11, name: 'test' })

  beforeEach(async () => {
    jest.clearAllMocks()
    const mockCli = mockClient()
    client = mockCli.client
    paginator = mockCli.paginator
    filter = filterCreator({
      client,
      paginator,
      config: DEFAULT_CONFIG,
      elementsSource: buildElementsSourceFromElements([]),
      fetchQuery: elementUtils.query.createMockQuery(),
    }) as typeof filter
  })

  describe('onFetch', () => {
    it('should add service url annotation if it is exist in the config', async () => {
      const elements = [screenInst].map(e => e.clone())
      await filter.onFetch(elements)
      expect(elements.map(e => e.elemID.getFullName()).sort())
        .toEqual(['jira.Screen.instance.Screen'])
      const [instance] = elements
      expect(instance.annotations).toEqual({
        [CORE_ANNOTATIONS.SERVICE_URL]: 'https://ori-salto-test.atlassian.net/secure/admin/ConfigureFieldScreen.jspa?id=11',
      })
    })
    it('should not add service url annotation if it is not exist in the config', async () => {
      const elements = [testInst].map(e => e.clone())
      await filter.onFetch(elements)
      expect(elements.map(e => e.elemID.getFullName()).sort())
        .toEqual(['jira.test.instance.test'])
      const [instance] = elements
      expect(instance.annotations).toEqual({})
    })
  })
  describe('onDeploy', () => {
    it('should add service url annotation if it is exist in the config', async () => {
      const changes = [screenInst].map(e => e.clone()).map(inst => toChange({ after: inst }))
      await filter.onDeploy(changes)
      expect(changes.map(getChangeData).map(e => e.elemID.getFullName()).sort())
        .toEqual(['jira.Screen.instance.Screen'])
      const instance = getChangeData(changes[0])
      expect(instance.annotations).toEqual({
        [CORE_ANNOTATIONS.SERVICE_URL]: 'https://ori-salto-test.atlassian.net/secure/admin/ConfigureFieldScreen.jspa?id=11',
      })
    })
    it('should not add service url annotation if it is not exist in the config', async () => {
      const changes = [testInst].map(e => e.clone()).map(inst => toChange({ after: inst }))
      await filter.onDeploy(changes)
      expect(changes.map(getChangeData).map(e => e.elemID.getFullName()).sort())
        .toEqual(['jira.test.instance.test'])
      const instance = getChangeData(changes[0])
      expect(instance.annotations).toEqual({})
    })
  })
})
