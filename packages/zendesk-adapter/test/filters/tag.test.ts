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
import { ObjectType, ElemID, InstanceElement, isInstanceElement, toChange, getChangeData, ReferenceExpression } from '@salto-io/adapter-api'
import { client as clientUtils, filterUtils, elements as elementUtils } from '@salto-io/adapter-components'
import { mockFunction } from '@salto-io/test-utils'
import { DEFAULT_CONFIG } from '../../src/config'
import ZendeskClient from '../../src/client/client'
import { ZENDESK } from '../../src/constants'
import filterCreator, { TAG_TYPE_NAME } from '../../src/filters/tag'

const mockDeployChange = jest.fn()
jest.mock('@salto-io/adapter-components', () => {
  const actual = jest.requireActual('@salto-io/adapter-components')
  return {
    ...actual,
    deployment: {
      ...actual.deployment,
      deployChange: jest.fn((...args) => mockDeployChange(...args)),
    },
  }
})

describe('tags filter', () => {
  let client: ZendeskClient
  type FilterType = filterUtils.FilterWith<'onFetch' | 'preDeploy' | 'onDeploy' | 'deploy'>
  let filter: FilterType
  const slaPolicyType = new ObjectType({ elemID: new ElemID(ZENDESK, 'sla_policy') })
  const triggerType = new ObjectType({ elemID: new ElemID(ZENDESK, 'trigger') })

  const triggerInstance = new InstanceElement(
    'test',
    triggerType,
    {
      title: 'test',
      actions: [
        {
          field: 'status',
          value: 'closed',
        },
        {
          field: 'remove_tags',
          value: 't1 t2',
        },
        {
          field: 'set_tags',
          value: 't3 t4 t5',
        },
        {
          field: 'current_tags',
          value: 't0',
        },
      ],
      conditions: {
        all: [
          {
            field: 'current_tags',
            operator: 'includes',
            value: '',
          },
        ],
        any: [
          {
            field: 'current_tags',
            operator: 'includes',
            value: 't5 t6',
          },
        ],
      },
    },
  )
  const slaPolicyInstance = new InstanceElement(
    'test',
    slaPolicyType,
    {
      title: 'test',
      filter: {
        all: [
          {
            field: 'current_tags',
            operator: 'includes',
            value: 't3',
          },
        ],
        any: [
          {
            field: 'current_tags',
            operator: 'includes',
            value: 't5 t6 t2',
          },
        ],
      },
      policy_metrics: [
        {
          priority: 'low',
          metric: 'first_reply_time',
          target: 480,
          business_hours: false,
        },
      ],
    },
  )
  let mockPaginator: clientUtils.Paginator
  const tagRef = (val: string): ReferenceExpression =>
    new ReferenceExpression(new ElemID(ZENDESK, TAG_TYPE_NAME, 'instance', val))

  beforeEach(async () => {
    jest.clearAllMocks()
    client = new ZendeskClient({
      credentials: { username: 'a', password: 'b', subdomain: 'ignore' },
    })
    mockPaginator = mockFunction<clientUtils.Paginator>()
      .mockImplementationOnce(async function *get() {
        yield [
          { users: [
            { id: 1, email: 'a@a.com' },
            { id: 2, email: 'b@b.com' },
          ] },
          { users: [
            { id: 3, email: 'c@c.com' },
          ] },
        ]
      })
    filter = filterCreator({
      client,
      paginator: mockPaginator,
      config: DEFAULT_CONFIG,
      fetchQuery: elementUtils.query.createMockQuery(),
    }) as FilterType
  })

  describe('onFetch', () => {
    it('should change the tags to be references', async () => {
      const elements = [
        slaPolicyType, triggerType, slaPolicyInstance, triggerInstance,
      ].map(e => e.clone())
      await filter.onFetch(elements)
      expect(elements.map(e => e.elemID.getFullName()).sort())
        .toEqual([
          'zendesk.sla_policy',
          'zendesk.sla_policy.instance.test',
          'zendesk.tag',
          'zendesk.tag.instance.t0',
          'zendesk.tag.instance.t1',
          'zendesk.tag.instance.t2',
          'zendesk.tag.instance.t3',
          'zendesk.tag.instance.t4',
          'zendesk.tag.instance.t5',
          'zendesk.tag.instance.t6',
          'zendesk.trigger',
          'zendesk.trigger.instance.test',
        ])
      const instances = elements.filter(isInstanceElement)
      const trigger = instances.find(e => e.elemID.typeName === 'trigger')
      expect(trigger?.value).toEqual({
        title: 'test',
        actions: [
          { field: 'status', value: 'closed' },
          { field: 'remove_tags', value: [tagRef('t1'), tagRef('t2')] },
          { field: 'set_tags', value: [tagRef('t3'), tagRef('t4'), tagRef('t5')] },
          { field: 'current_tags', value: [tagRef('t0')] },
        ],
        conditions: {
          all: [
            { field: 'current_tags', operator: 'includes', value: [] },
          ],
          any: [
            { field: 'current_tags', operator: 'includes', value: [tagRef('t5'), tagRef('t6')] },
          ],
        },
      })
      const sla = instances.find(e => e.elemID.typeName === 'sla_policy')
      expect(sla?.value).toEqual({
        title: 'test',
        filter: {
          all: [
            { field: 'current_tags', operator: 'includes', value: [tagRef('t3')] },
          ],
          any: [
            { field: 'current_tags', operator: 'includes', value: [tagRef('t5'), tagRef('t6'), tagRef('t2')] },
          ],
        },
        policy_metrics: [
          {
            priority: 'low',
            metric: 'first_reply_time',
            target: 480,
            business_hours: false,
          },
        ],
      })
    })
  })
  describe('preDeploy', () => {
    it('should change the tags value to be in the correct deploy format', async () => {
      const resolvedSlaPolicyInstance = slaPolicyInstance.clone()
      resolvedSlaPolicyInstance.value = {
        title: 'test',
        filter: {
          all: [{ field: 'current_tags', operator: 'includes', value: ['t3'] }],
          any: [{ field: 'current_tags', operator: 'includes', value: ['t5', 't6', 't2'] }],
        },
        policy_metrics: [
          {
            priority: 'low',
            metric: 'first_reply_time',
            target: 480,
            business_hours: false,
          },
        ],
      }
      const resolvedTriggerInstance = triggerInstance.clone()
      resolvedTriggerInstance.value = {
        title: 'test',
        actions: [
          { field: 'status', value: 'closed' },
          { field: 'remove_tags', value: ['t1', 't2'] },
          { field: 'set_tags', value: ['t3', 't4', 't5'] },
          { field: 'current_tags', value: ['t0'] },
        ],
        conditions: {
          all: [{ field: 'current_tags', operator: 'includes', value: [] }],
          any: [{ field: 'current_tags', operator: 'includes', value: ['t5', 't6'] }],
        },
      }
      const instances = [resolvedSlaPolicyInstance, resolvedTriggerInstance]
      const changes = instances.map(instance => toChange({ after: instance }))
      await filter.preDeploy(changes)
      const changedInstances = changes.map(getChangeData)
      const trigger = changedInstances.find(inst => inst.elemID.typeName === 'trigger')
      expect(trigger?.value).toEqual({
        title: 'test',
        actions: [
          { field: 'status', value: 'closed' },
          { field: 'remove_tags', value: 't1 t2' },
          { field: 'set_tags', value: 't3 t4 t5' },
          { field: 'current_tags', value: 't0' },
        ],
        conditions: {
          all: [{ field: 'current_tags', operator: 'includes', value: '' }],
          any: [{ field: 'current_tags', operator: 'includes', value: 't5 t6' }],
        },
      })
      const sla = changedInstances.find(e => e.elemID.typeName === 'sla_policy')
      expect(sla?.value).toEqual({
        title: 'test',
        filter: {
          all: [{ field: 'current_tags', operator: 'includes', value: 't3' }],
          any: [{ field: 'current_tags', operator: 'includes', value: 't5 t6 t2' }],
        },
        policy_metrics: [
          {
            priority: 'low',
            metric: 'first_reply_time',
            target: 480,
            business_hours: false,
          },
        ],
      })
    })
  })
  describe('onDeploy', () => {
    it('should change the tags value to be reference expressions', async () => {
      const resolvedSlaPolicyInstance = slaPolicyInstance.clone()
      resolvedSlaPolicyInstance.value = {
        title: 'test',
        filter: {
          all: [{ field: 'current_tags', operator: 'includes', value: 't3' }],
          any: [{ field: 'current_tags', operator: 'includes', value: 't5 t6 t2' }],
        },
        policy_metrics: [
          {
            priority: 'low',
            metric: 'first_reply_time',
            target: 480,
            business_hours: false,
          },
        ],
      }
      const resolvedTriggerInstance = triggerInstance.clone()
      resolvedTriggerInstance.value = {
        title: 'test',
        actions: [
          { field: 'status', value: 'closed' },
          { field: 'remove_tags', value: 't1 t2' },
          { field: 'set_tags', value: 't3 t4 t5' },
          { field: 'current_tags', value: 't0' },
        ],
        conditions: {
          all: [{ field: 'current_tags', operator: 'includes', value: '' }],
          any: [{ field: 'current_tags', operator: 'includes', value: 't5 t6' }],
        },
      }
      const instances = [resolvedSlaPolicyInstance, resolvedTriggerInstance]
      const changes = instances.map(instance => toChange({ after: instance }))
      await filter.onDeploy(changes)
      const changedInstances = changes.map(getChangeData)
      const sla = changedInstances.find(inst => inst.elemID.typeName === 'sla_policy')
      expect(sla?.value).toEqual({
        title: 'test',
        filter: {
          all: [
            { field: 'current_tags', operator: 'includes', value: [tagRef('t3')] },
          ],
          any: [
            { field: 'current_tags', operator: 'includes', value: [tagRef('t5'), tagRef('t6'), tagRef('t2')] },
          ],
        },
        policy_metrics: [
          {
            priority: 'low',
            metric: 'first_reply_time',
            target: 480,
            business_hours: false,
          },
        ],
      })
      const trigger = changedInstances.find(inst => inst.elemID.typeName === 'trigger')
      expect(trigger?.value).toEqual({
        title: 'test',
        actions: [
          { field: 'status', value: 'closed' },
          { field: 'remove_tags', value: [tagRef('t1'), tagRef('t2')] },
          { field: 'set_tags', value: [tagRef('t3'), tagRef('t4'), tagRef('t5')] },
          { field: 'current_tags', value: [tagRef('t0')] },
        ],
        conditions: {
          all: [
            { field: 'current_tags', operator: 'includes', value: [] },
          ],
          any: [
            { field: 'current_tags', operator: 'includes', value: [tagRef('t5'), tagRef('t6')] },
          ],
        },
      })
    })
  })
  describe('deploy', () => {
    it('should not call deployChange function', async () => {
      const tag = new InstanceElement(
        'test',
        new ObjectType({ elemID: new ElemID(ZENDESK, TAG_TYPE_NAME) }),
        { id: 'test' },
      )
      const change = toChange({ after: tag })
      const res = await filter.deploy([change])
      expect(mockDeployChange).not.toHaveBeenCalled()
      expect(res.leftoverChanges).toHaveLength(0)
      expect(res.deployResult.errors).toHaveLength(0)
      expect(res.deployResult.appliedChanges).toEqual([change])
    })
    it('should only apply relevant changes', async () => {
      const inst = new InstanceElement(
        'test',
        new ObjectType({ elemID: new ElemID(ZENDESK, 'dummy') }),
        { id: 'test' },
      )
      const change = toChange({ after: inst })
      const res = await filter.deploy([change])
      expect(mockDeployChange).not.toHaveBeenCalled()
      expect(res.leftoverChanges).toHaveLength(1)
      expect(res.deployResult.errors).toHaveLength(0)
      expect(res.deployResult.appliedChanges).toHaveLength(0)
    })
  })
})
