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
import { Values } from '@salto-io/adapter-api'


export const createAutomationValues = (name: string): Values => ({
  name,
  state: 'ENABLED',
  authorAccountId: '61d44bf59ee70a00685fa6b6',
  actor: {
    type: 'ACCOUNT_ID',
    value: '557058:f58131cb-b67d-43c7-b30d-6b58d40bd077',
  },
  trigger: {
    component: 'TRIGGER',
    schemaVersion: 2,
    type: 'jira.issue.field.changed',
    value: {
      changeType: 'VALUE_ADDED',
      fields: [
        {
          value: 'components',
          type: 'field',
        },
      ],
      actions: [
        'create',
      ],
    },
  },
  components: [
    {
      component: 'BRANCH',
      schemaVersion: 1,
      type: 'jira.issue.related',
      value: {
        relatedType: 'parent',
        jql: '',
        onlyUpdatedIssues: false,
        similarityLimit: 40,
        compareValue: 0,
      },
      children: [
        {
          component: 'CONDITION',
          schemaVersion: 3,
          type: 'jira.issue.condition',
          value: {
            selectedField: {
              type: 'ID',
              value: 'status',
            },
            selectedFieldType: 'status',
            comparison: 'ONE_OF',
            compareValue: {
              type: 'NAME',
              value: '["Approved"]',
              multiValue: true,
            },
          },
        },
        {
          component: 'CONDITION',
          schemaVersion: 1,
          type: 'jira.jql.condition',
          rawValue: 'priority > Medium',
        },
        {
          component: 'ACTION',
          schemaVersion: 10,
          type: 'jira.issue.create',
          value: {
            operations: [
              {
                field: {
                  type: 'ID',
                  value: 'summary',
                },
                fieldType: 'summary',
                type: 'SET',
                value: 'value',
              },
              {
                field: {
                  type: 'ID',
                  value: 'description',
                },
                fieldType: 'description',
                type: 'SET',
                value: 'descruotuib',
              },
              {
                field: {
                  type: 'ID',
                  value: 'project',
                },
                fieldType: 'project',
                type: 'SET',
                value: {
                  value: 'current',
                  type: 'COPY',
                },
              },
              {
                field: {
                  type: 'ID',
                  value: 'issuetype',
                },
                fieldType: 'issuetype',
                type: 'SET',
                value: {
                  type: 'COPY',
                  value: 'current',
                },
              },
            ],
            sendNotifications: false,
          },
        },
      ],
    },
    {
      component: 'ACTION',
      schemaVersion: 10,
      type: 'jira.issue.create',
      value: {
        operations: [
          {
            field: {
              type: 'ID',
              value: 'summary',
            },
            fieldType: 'summary',
            type: 'SET',
            value: 'value',
          },
          {
            field: {
              type: 'ID',
              value: 'description',
            },
            fieldType: 'description',
            type: 'SET',
            value: 'description',
          },
          {
            field: {
              type: 'ID',
              value: 'project',
            },
            fieldType: 'project',
            type: 'SET',
            value: {
              value: 'current',
              type: 'COPY',
            },
          },
          {
            field: {
              type: 'ID',
              value: 'issuetype',
            },
            fieldType: 'issuetype',
            type: 'SET',
            value: {
              type: 'COPY',
              value: 'current',
            },
          },
        ],
        sendNotifications: false,
      },
    },
  ],
  canOtherRuleTrigger: false,
  notifyOnError: 'FIRSTERROR',
  projects: [
    {
      projectTypeKey: 'business',
    },
  ],
  writeAccessType: 'UNRESTRICTED',
})
