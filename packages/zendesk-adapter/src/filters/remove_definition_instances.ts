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
import _ from 'lodash'
import { cloneDeepWithoutRefs, isInstanceElement } from '@salto-io/adapter-api'
import { safeJsonStringify } from '@salto-io/adapter-utils'
import { logger } from '@salto-io/logging'
import { FilterCreator } from '../filter'

const log = logger(module)

// We don't fetch those type names (except for trigger_definition) by default
// But since we did in the past and we want to be backward compatible, we keep them in the filter
// Can be removed after SALTO-1792
const DEFINITION_TYPE_NAMES = [
  'macro_definition',
  'macros_actions',
  'trigger_definition',
  'sla_policy_definition',
  'routing_attribute_definition',
]

/**
 * Removes the definition instances
 */
const filterCreator: FilterCreator = () => ({
  onFetch: async elements => log.time(async () => {
    // ---- Start debugging SALTO-2305 ----
    const triggerDefs = elements
      .filter(isInstanceElement)
      .find(inst => inst.elemID.typeName === 'trigger_definition')
    if (triggerDefs) {
      const triggerDefsVal = safeJsonStringify(cloneDeepWithoutRefs(triggerDefs?.value))
      const chunks = _.chunk(triggerDefsVal, 200 * 1024).map(chunk => chunk.join(''))
      chunks.forEach((chunk, i) => {
        log.debug(`DEBUGGING2305:${i}:${chunk}`)
      })
    }
    // ---- End debugging SALTO-2305 ----

    _.remove(elements,
      element =>
        isInstanceElement(element) && DEFINITION_TYPE_NAMES.includes(element.elemID.typeName))
  }, 'Remove definition instances filter'),
})

export default filterCreator
