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
import { Change, ChangeDataType, DeployResult, ElemID, getChangeData, InstanceElement, isAdditionChange, ReadOnlyElementsSource } from '@salto-io/adapter-api'
import { config, deployment, client as clientUtils, elements as elementUtils } from '@salto-io/adapter-components'
import { resolveChangeElement, resolveValues, safeJsonStringify } from '@salto-io/adapter-utils'
import { logger } from '@salto-io/logging'
import { collections } from '@salto-io/lowerdash'
import _ from 'lodash'
import JiraClient from '../client/client'
import { getLookUpName } from '../reference_mapping'

const { awu } = collections.asynciterable

const log = logger(module)

type DeployChangeParam = {
  change: Change<InstanceElement>
  client: JiraClient
  apiDefinitions: config.AdapterApiConfig
  fieldsToIgnore?: string[] | ((path: ElemID) => boolean)
  additionalUrlVars?: Record<string, string>
  elementsSource?: ReadOnlyElementsSource
}

/**
 * Deploy change with the standard "add", "modify", "remove" endpoints
 */
export const defaultDeployChange = async ({
  change,
  client,
  apiDefinitions,
  fieldsToIgnore = [],
  additionalUrlVars,
  elementsSource,
}: DeployChangeParam): Promise<
  clientUtils.ResponseValue | clientUtils.ResponseValue[] | undefined
> => {
  const changeToDeploy = await elementUtils.swagger.flattenAdditionalProperties(
    await resolveChangeElement(change, getLookUpName, resolveValues, elementsSource),
    elementsSource,
  )
  const response = await deployment.deployChange(
    changeToDeploy,
    client,
    apiDefinitions.types[getChangeData(change).elemID.typeName]?.deployRequests,
    fieldsToIgnore,
    additionalUrlVars,
    elementsSource,
  )

  if (isAdditionChange(change)) {
    if (!Array.isArray(response)) {
      const serviceIdField = apiDefinitions.types[getChangeData(change).elemID.typeName]?.transformation?.serviceIdField ?? 'id'
      if (response?.[serviceIdField] !== undefined) {
        getChangeData(change).value[serviceIdField] = response[serviceIdField]
      }
    } else {
      log.warn('Received unexpected response from deployChange: %o', response)
    }
  }
  return response
}

/**
 * Runs a deploy function of a single change on many changes and returns the deploy results
 */
export const deployChanges = async <T extends Change<ChangeDataType>>(
  changes: T[],
  deployChangeFunc: (change: T) => Promise<void>
): Promise<DeployResult> => {
  const result = await awu(changes)
    .map(async change => {
      try {
        await deployChangeFunc(change)
        return change
      } catch (err) {
        err.message = `Deployment of ${getChangeData(change).elemID.getFullName()} failed: ${err}`
        if (err instanceof clientUtils.HTTPError && _.isPlainObject(err.response.data)) {
          const errorMessages = [
            ...(Array.isArray(err.response.data.errorMessages)
              ? err.response.data.errorMessages
              : []),
            ...(_.isPlainObject(err.response.data.errors)
              ? [safeJsonStringify(err.response.data.errors)]
              : []),
          ]
          if (errorMessages.length > 0) {
            err.message = `${err.message}. ${errorMessages.join(', ')}`
          }
        }
        return err
      }
    })
    .toArray()

  const [errors, appliedChanges] = _.partition(result, _.isError)
  return {
    errors,
    appliedChanges,
  }
}
