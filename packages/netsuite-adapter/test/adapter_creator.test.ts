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
  AdapterFailureInstallResult, AdapterSuccessInstallResult,
  ElemID, InstanceElement, isAdapterSuccessInstallResult, ObjectType,
} from '@salto-io/adapter-api'
import * as cli from '@salto-io/suitecloud-cli'
import { buildElementsSourceFromElements } from '@salto-io/adapter-utils'
import Bottleneck from 'bottleneck'
import { adapter } from '../src/adapter_creator'
import SdfClient from '../src/client/sdf_client'
import NetsuiteAdapter from '../src/adapter'
import {
  TYPES_TO_SKIP, FILE_PATHS_REGEX_SKIP_LIST, FETCH_ALL_TYPES_AT_ONCE, SDF_CONCURRENCY_LIMIT,
  FETCH_TYPE_TIMEOUT_IN_MINUTES, CLIENT_CONFIG,
  MAX_ITEMS_IN_IMPORT_OBJECTS_REQUEST, FETCH_TARGET, SKIP_LIST, SUITEAPP_CLIENT_CONFIG,
  SUITEAPP_CONCURRENCY_LIMIT,
  FETCH,
  INCLUDE,
  EXCLUDE,
  DEPLOY,
  DEPLOY_REFERENCED_ELEMENTS,
  WARN_STALE_DATA,
  INSTALLED_SUITEAPPS,
  ADDITIONAL_DEPS,
  VALIDATE,
} from '../src/constants'
import { mockGetElemIdFunc } from './utils'
import SuiteAppClient from '../src/client/suiteapp_client/suiteapp_client'
import { SdfCredentials } from '../src/client/credentials'

jest.mock('../src/client/sdf_client')
jest.mock('../src/client/suiteapp_client/suiteapp_client')
jest.mock('../src/adapter')
jest.mock('@salto-io/suitecloud-cli')

const mockDownload = cli.SdkDownloadService.download as jest.Mock
mockDownload.mockResolvedValue({ success: true, installedVersion: '123' })

describe('NetsuiteAdapter creator', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
  })

  const credentials = new InstanceElement(
    ElemID.CONFIG_NAME,
    adapter.authenticationMethods.basic.credentialsType,
    {
      accountId: 'foo-a',
      tokenId: 'bar',
      tokenSecret: 'secret',
      suiteAppTokenId: '',
      suiteAppTokenSecret: '',
    },
  )

  const sdfConcurrencyLimit = 2
  const fetchTypeTimeoutInMinutes = 1
  const maxItemsInImportObjectsRequest = 3
  const clientConfig = {
    [FETCH_ALL_TYPES_AT_ONCE]: false,
    [FETCH_TYPE_TIMEOUT_IN_MINUTES]: fetchTypeTimeoutInMinutes,
    [MAX_ITEMS_IN_IMPORT_OBJECTS_REQUEST]: maxItemsInImportObjectsRequest,
    [SDF_CONCURRENCY_LIMIT]: sdfConcurrencyLimit,
    notExistInClient: ['not exist in client'],
  }
  const config = new InstanceElement(
    ElemID.CONFIG_NAME,
    adapter.configType as ObjectType,
    {
      [SKIP_LIST]: {},
      [TYPES_TO_SKIP]: ['test1'],
      [FILE_PATHS_REGEX_SKIP_LIST]: ['^/Templates.*'],
      [CLIENT_CONFIG]: clientConfig,
      notExist: ['not exist'],
    }
  )

  describe('validateCredentials', () => {
    const suiteAppClientValidateMock = jest.spyOn(SuiteAppClient, 'validateCredentials')
    const netsuiteValidateMock = jest.spyOn(SdfClient, 'validateCredentials')

    beforeEach(() => {
      jest.mock('@salto-io/suitecloud-cli', () => undefined, { virtual: true })
      suiteAppClientValidateMock.mockReset()
      netsuiteValidateMock.mockReset()
    })

    it('should call validateCredentials with the correct credentials', async () => {
      await adapter.validateCredentials(credentials)
      expect(netsuiteValidateMock).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'FOO_A',
        tokenId: 'bar',
        tokenSecret: 'secret',
      }))
      expect(suiteAppClientValidateMock).not.toHaveBeenCalledWith()
    })

    it('should call validateCredentials of SuiteAppClient when SuiteApp credentials were passed', async () => {
      suiteAppClientValidateMock.mockResolvedValue(undefined)

      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        suiteAppTokenId: 'aaa',
        suiteAppTokenSecret: 'bbb',
        suiteAppActivationKey: 'ccc',
      }

      await adapter.validateCredentials(cred)
      expect(netsuiteValidateMock).toHaveBeenCalledWith({ ...cred.value, accountId: 'FOO_A' })
      expect(suiteAppClientValidateMock).toHaveBeenCalledWith({ ...cred.value, accountId: 'FOO_A' })
    })

    it('SDF validation failure should throw SDF error', async () => {
      suiteAppClientValidateMock.mockResolvedValue(undefined)
      netsuiteValidateMock.mockRejectedValue(new Error(''))

      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        suiteAppTokenId: 'aaa',
        suiteAppTokenSecret: 'bbb',
        suiteAppActivationKey: 'ccc',
      }

      await expect(adapter.validateCredentials(cred)).rejects.toThrow('SDF Authentication failed.')
    })

    it('SuiteApp validation failure should throw SuiteApp error', async () => {
      suiteAppClientValidateMock.mockRejectedValue(new Error(''))

      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        suiteAppTokenId: 'aaa',
        suiteAppTokenSecret: 'bbb',
        suiteAppActivationKey: 'ccc',
      }

      await expect(adapter.validateCredentials(cred)).rejects.toThrow('SuiteApp Authentication failed.')
    })

    it('should throw when receiving invalid accountId', async () => {
      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        accountId: ' account-id',
      }
      await expect(adapter.validateCredentials(cred)).rejects
        .toThrow(/received an invalid accountId value.*/g)
    })
  })

  describe('client creation', () => {
    it('should create the client correctly', () => {
      jest.spyOn(SdfClient.prototype, 'getCredentials').mockReturnValue({ accountId: 'someId' } as SdfCredentials)
      adapter.operations({
        credentials,
        config,
        elementsSource: buildElementsSourceFromElements([]),
      })
      expect(SdfClient).toHaveBeenCalledWith({
        credentials: {
          accountId: 'FOO_A',
          tokenId: 'bar',
          tokenSecret: 'secret',
          suiteAppTokenId: undefined,
          suiteAppTokenSecret: undefined,
        },
        config: clientConfig,
        globalLimiter: expect.any(Bottleneck),
      })
    })
  })

  describe('suiteapp client creation', () => {
    it('should not create the client if credentials were not passed', () => {
      adapter.operations({
        credentials,
        config,
        elementsSource: buildElementsSourceFromElements([]),
      })
      expect(SuiteAppClient).not.toHaveBeenCalled()
    })

    it('should throw when missing activation key', () => {
      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        suiteAppTokenId: 'aaa',
        suiteAppTokenSecret: 'bbb',
        suiteAppActivationKey: '',
      }

      expect(() => adapter.operations({
        credentials: cred,
        config,
        elementsSource: buildElementsSourceFromElements([]),
      })).toThrow('Missing SuiteApp login creds')
    })

    it('should create the client if credentials were passed', () => {
      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        suiteAppTokenId: 'aaa',
        suiteAppTokenSecret: 'bbb',
        suiteAppActivationKey: 'ccc',
      }

      adapter.operations({
        credentials: cred,
        config,
        elementsSource: buildElementsSourceFromElements([]),
      })
      expect(SuiteAppClient).toHaveBeenCalledWith({
        credentials: { ...cred.value, accountId: 'FOO_A' },
        globalLimiter: expect.any(Bottleneck),
      })
    })

    it('should pass the config to client if passed', () => {
      const cred = credentials.clone()
      cred.value = {
        ...cred.value,
        suiteAppTokenId: 'aaa',
        suiteAppTokenSecret: 'bbb',
        suiteAppActivationKey: 'ccc',
      }

      const configuration = config.clone()
      configuration.value = {
        ...config.value,
        [SUITEAPP_CLIENT_CONFIG]: {
          [SUITEAPP_CONCURRENCY_LIMIT]: 5,
        },
      }

      adapter.operations({
        credentials: cred,
        config: configuration,
        elementsSource: buildElementsSourceFromElements([]),
      })
      expect(SuiteAppClient).toHaveBeenCalledWith({
        credentials: { ...cred.value, accountId: 'FOO_A' },
        config: {
          [SUITEAPP_CONCURRENCY_LIMIT]: 5,
        },
        globalLimiter: expect.any(Bottleneck),
      })
    })
  })

  describe('adapter creation', () => {
    const elementsSource = buildElementsSourceFromElements([])

    it('should create the adapter correctly', () => {
      adapter.operations({
        credentials,
        config,
        getElemIdFunc: mockGetElemIdFunc,
        elementsSource,
      })
      expect(NetsuiteAdapter).toHaveBeenCalledWith({
        client: expect.any(Object),
        config: {
          [SKIP_LIST]: {},
          [TYPES_TO_SKIP]: ['test1'],
          [FILE_PATHS_REGEX_SKIP_LIST]: ['^/Templates.*'],
          [CLIENT_CONFIG]: clientConfig,
        },
        elementsSource,
        getElemIdFunc: mockGetElemIdFunc,
      })
    })

    it('should override FETCH_ALL_TYPES_AT_ONCE if received FETCH_TARGET', () => {
      const conf = new InstanceElement(
        ElemID.CONFIG_NAME,
        adapter.configType as ObjectType,
        {
          [CLIENT_CONFIG]: {
            [FETCH_ALL_TYPES_AT_ONCE]: true,
          },
          [FETCH_TARGET]: {
            filePaths: ['aaa'],
          },
        }
      )

      adapter.operations({
        credentials,
        config: conf,
        getElemIdFunc: mockGetElemIdFunc,
        elementsSource,
      })
      expect(NetsuiteAdapter).toHaveBeenCalledWith({
        client: expect.any(Object),
        config: {
          [CLIENT_CONFIG]: {
            [FETCH_ALL_TYPES_AT_ONCE]: false,
          },
          [FETCH_TARGET]: expect.any(Object),
        },
        elementsSource,
        getElemIdFunc: mockGetElemIdFunc,
      })
    })

    it('should create the adapter correctly when not having config', () => {
      adapter.operations({
        credentials,
        getElemIdFunc: mockGetElemIdFunc,
        elementsSource,
      })
      expect(NetsuiteAdapter).toHaveBeenCalledWith({
        client: expect.any(Object),
        config: {},
        elementsSource,
        getElemIdFunc: mockGetElemIdFunc,
      })
    })

    it('should throw an error when creating the adapter with an invalid regex for FILE_PATHS_REGEX_SKIP_LIST', () => {
      const invalidConfig = new InstanceElement(
        ElemID.CONFIG_NAME,
        adapter.configType as ObjectType,
        {
          [FILE_PATHS_REGEX_SKIP_LIST]: ['\\'],
        }
      )
      expect(
        () => adapter.operations({
          credentials,
          config: invalidConfig,
          getElemIdFunc: mockGetElemIdFunc,
          elementsSource: buildElementsSourceFromElements([]),
        })
      ).toThrow()
    })

    it('should throw an error when include is invalid', () => {
      const invalidConfig = new InstanceElement(
        ElemID.CONFIG_NAME,
        adapter.configType as ObjectType,
        {
          [FETCH]: {
            [INCLUDE]: {
              types: 'supposed to be an array',
            },
          },
        }
      )
      expect(
        () => adapter.operations({
          credentials,
          config: invalidConfig,
          getElemIdFunc: mockGetElemIdFunc,
          elementsSource: buildElementsSourceFromElements([]),
        })
      ).toThrow()
    })

    it('should throw an error when exclude is invalid', () => {
      const invalidConfig = new InstanceElement(
        ElemID.CONFIG_NAME,
        adapter.configType as ObjectType,
        {
          [FETCH]: {
            [EXCLUDE]: {
              types: [
                { name: ['should be a string'] },
              ],
            },
          },
        }
      )
      expect(
        () => adapter.operations({
          credentials,
          config: invalidConfig,
          getElemIdFunc: mockGetElemIdFunc,
          elementsSource: buildElementsSourceFromElements([]),
        })
      ).toThrow()
    })

    describe('deploy params', () => {
      it('should throw an error when deployReferencedElements is invalid', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [DEPLOY]: {
              [DEPLOY_REFERENCED_ELEMENTS]: 'should be a boolean',
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })

      it('should throw an error when warnOnStaleWorkspaceData is invalid', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [DEPLOY]: {
              [WARN_STALE_DATA]: 'should be a boolean',
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })
      it('should throw an error when \'validate\' is invalid', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [DEPLOY]: {
              [VALIDATE]: 'should be a boolean',
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })
      it('should throw an error when additionalDependencies is invalid', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [DEPLOY]: {
              [ADDITIONAL_DEPS]: 'should be an object',
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })
      it('should throw an error when additionalDependencies.include is invalid', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [DEPLOY]: {
              [ADDITIONAL_DEPS]: {
                include: { features: ['should be list of strings', 1] },
              },
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })
      it('should throw an error when additionalDependencies.exclude is invalid', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [DEPLOY]: {
              [ADDITIONAL_DEPS]: {
                exclude: { objects: ['should be list of strings', 1] },
              },
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })
    })

    describe('installedSuiteApps', () => {
      it('should throw an error when installedSuiteApps is not a list', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [CLIENT_CONFIG]: {
              [INSTALLED_SUITEAPPS]: 2,
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })

      it('should throw an error when installedSuiteApps has an item that is not a string', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [CLIENT_CONFIG]: {
              [INSTALLED_SUITEAPPS]: ['a.b.c', 2],
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })

      it('should throw an error when installedSuiteApps has an item that is not a valid id', () => {
        const invalidConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [CLIENT_CONFIG]: {
              [INSTALLED_SUITEAPPS]: ['a', 'a.b.c'],
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: invalidConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).toThrow()
      })

      it('should not throw an error when installedSuiteApps is valid', () => {
        const validConfig = new InstanceElement(
          ElemID.CONFIG_NAME,
          adapter.configType as ObjectType,
          {
            [CLIENT_CONFIG]: {
              [INSTALLED_SUITEAPPS]: ['a.b.c', 'b.c.d'],
            },
          }
        )
        expect(
          () => adapter.operations({
            credentials,
            config: validConfig,
            getElemIdFunc: mockGetElemIdFunc,
            elementsSource: buildElementsSourceFromElements([]),
          })
        ).not.toThrow()
      })
    })
  })

  describe('install', () => {
    it('should have an install functions', () => {
      expect(adapter.install).toBeDefined()
    })
    it('when installation succeeds', async () => {
      if (adapter.install) {
        const res = await adapter.install()
        expect(isAdapterSuccessInstallResult(res)).toBe(true)
        expect((res as AdapterSuccessInstallResult).installedVersion).toEqual('123')
        expect(mockDownload).toHaveBeenCalled()
      }
    })
    it('when installation fails with an expection', async () => {
      mockDownload.mockImplementationOnce(() => {
        throw new Error('FAILED')
      })
      if (adapter.install) {
        const res = await adapter.install()
        expect(isAdapterSuccessInstallResult(res)).toBe(false)
        expect((res as AdapterFailureInstallResult).errors).toEqual(['FAILED'])
      }
    })
    it('when installation fails with sdf errors in return value', async () => {
      mockDownload.mockImplementationOnce(() => ({ errors: ['FAILED'], success: false }))
      if (adapter.install) {
        const res = await adapter.install()
        expect(isAdapterSuccessInstallResult(res)).toBe(false)
        expect((res as AdapterFailureInstallResult).errors).toEqual(['FAILED'])
      }
    })
  })
})
