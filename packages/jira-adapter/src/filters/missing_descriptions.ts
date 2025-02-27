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
import { Element, isInstanceElement } from '@salto-io/adapter-api'
import { FilterCreator } from '../filter'
import { FIELD_CONFIGURATION_ITEM_TYPE_NAME, PROJECT_ROLE_TYPE } from '../constants'
import { FIELD_TYPE_NAME } from './fields/constants'


const RELEVANT_TYPES = [
  PROJECT_ROLE_TYPE,
  FIELD_TYPE_NAME,
  FIELD_CONFIGURATION_ITEM_TYPE_NAME,
]

const filter: FilterCreator = () => ({
  onFetch: async (elements: Element[]) => {
    elements
      .filter(isInstanceElement)
      .filter(instance => RELEVANT_TYPES.includes(instance.elemID.typeName))
      .filter(instance => instance.value.description === undefined)
      .forEach(instance => {
        instance.value.description = ''
      })
  },
})

export default filter
