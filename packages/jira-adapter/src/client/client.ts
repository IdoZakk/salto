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
import { client as clientUtils } from '@salto-io/adapter-components'
import { logger } from '@salto-io/logging'
import { createConnection } from './connection'
import { JIRA } from '../constants'
import { Credentials } from '../auth'

const log = logger(module)

const {
  DEFAULT_RETRY_OPTS, RATE_LIMIT_UNLIMITED_MAX_CONCURRENT_REQUESTS,
} = clientUtils

const DEFAULT_MAX_CONCURRENT_API_REQUESTS: Required<clientUtils.ClientRateLimitConfig> = {
  total: RATE_LIMIT_UNLIMITED_MAX_CONCURRENT_REQUESTS,
  get: 20,
  deploy: 2,
}

const DEFAULT_PAGE_SIZE: Required<clientUtils.ClientPageSizeConfig> = {
  get: 50,
}


export const PRIVATE_API_HEADERS = {
  'X-Atlassian-Token': 'no-check',
}

export const JSP_API_HEADERS = {
  ...PRIVATE_API_HEADERS,
  'Content-Type': 'application/x-www-form-urlencoded',
}


export default class JiraClient extends clientUtils.AdapterHTTPClient<
  Credentials, clientUtils.ClientRateLimitConfig
> {
  constructor(
    clientOpts: clientUtils.ClientOpts<Credentials, clientUtils.ClientRateLimitConfig>,
  ) {
    super(
      JIRA,
      clientOpts,
      createConnection,
      {
        pageSize: DEFAULT_PAGE_SIZE,
        rateLimit: DEFAULT_MAX_CONCURRENT_API_REQUESTS,
        retry: DEFAULT_RETRY_OPTS,
      }
    )
  }

  public get baseUrl(): string {
    return this.credentials.baseUrl
  }

  public async getSinglePage(
    args: clientUtils.ClientBaseParams,
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    try {
      return await super.getSinglePage(args)
    } catch (e) {
      // The http_client code catches the original error and transforms it such that it removes
      // the parsed information (like the status code), so we have to parse the string here in order
      // to realize what type of error was thrown
      if (e.message.endsWith('Request failed with status code 404')) {
        log.warn('Suppressing 404 error %o', e)
        return {
          data: [],
          status: 404,
        }
      }
      throw e
    }
  }

  // Sends a post request to a JIRA JSP page
  public async jspPost(
    args: clientUtils.ClientDataParams & { data: Record<string, string> },
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    return this.post({
      ...args,
      data: new URLSearchParams(args.data),
      headers: {
        ...JSP_API_HEADERS,
        ...(args.headers ?? {}),
      },
    })
  }

  public async getPrivate(
    args: clientUtils.ClientBaseParams,
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    return this.getSinglePage({
      ...args,
      headers: {
        ...PRIVATE_API_HEADERS,
        ...(args.headers ?? {}),
      },
    })
  }

  public async deletePrivate(
    args: clientUtils.ClientBaseParams,
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    return this.delete({
      ...args,
      headers: {
        ...PRIVATE_API_HEADERS,
        ...(args.headers ?? {}),
      },
    })
  }

  public async putPrivate(
    args: clientUtils.ClientDataParams,
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    return this.put({
      ...args,
      headers: {
        ...PRIVATE_API_HEADERS,
        ...(args.headers ?? {}),
      },
    })
  }

  public async postPrivate(
    args: clientUtils.ClientDataParams,
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    return this.post({
      ...args,
      headers: {
        ...PRIVATE_API_HEADERS,
        ...(args.headers ?? {}),
      },
    })
  }

  public async patchPrivate(
    args: clientUtils.ClientDataParams,
  ): Promise<clientUtils.Response<clientUtils.ResponseValue | clientUtils.ResponseValue[]>> {
    return this.patch({
      ...args,
      headers: {
        ...PRIVATE_API_HEADERS,
        ...(args.headers ?? {}),
      },
    })
  }
}
