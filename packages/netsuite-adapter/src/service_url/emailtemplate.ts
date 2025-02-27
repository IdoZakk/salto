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

import { setInstancesUrls } from './instances_urls'
import { ServiceUrlSetter } from './types'


const setServiceUrl: ServiceUrlSetter = async (elements, client) => {
  await setInstancesUrls({
    elements,
    client,
    filter: element => element.refType.elemID.name === 'emailtemplate',
    query: 'SELECT id, scriptid FROM emailtemplate ORDER BY id ASC',
    generateUrl: id => `app/crm/common/merge/emailtemplate.nl?id=${id}&cp=F`,
  })
}

export default setServiceUrl
