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
import {
  isInstanceElement, ChangeValidator, getChangeData, isAdditionOrModificationChange,
} from '@salto-io/adapter-api'

const changeValidator: ChangeValidator = async changes => (
  changes
    .filter(isAdditionOrModificationChange)
    .map(getChangeData)
    .filter(elem => !isInstanceElement(elem))
    .map(({ elemID }) => ({
      elemID,
      severity: 'Error',
      message: 'Type definitions are read only',
      detailedMessage: `Changing (${elemID.name}) is not supported`,
    }))
)

export default changeValidator
