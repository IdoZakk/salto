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

import { ElemID, InstanceElement, ObjectType, ReferenceExpression, Element, BuiltinTypes, isInstanceElement } from '@salto-io/adapter-api'
import { addReferencesToInstanceNames, referencedInstanceNamesFilterCreator,
  createReferenceIndex } from '../../src/filters/referenced_instance_names'
import { FilterWith } from '../../src/filter_utils'
import { Paginator } from '../../src/client'
import { createMockQuery } from '../../src/elements/query'

const ADAPTER_NAME = 'myAdapter'

describe('referenced instances', () => {
  const generateElements = (): Element[] => {
    const recipeType = new ObjectType({
      elemID: new ElemID(ADAPTER_NAME, 'recipe'),
      fields: {
        name: { refType: BuiltinTypes.STRING },
        book_id: { refType: BuiltinTypes.NUMBER },
      },
    })
    const bookType = new ObjectType({
      elemID: new ElemID(ADAPTER_NAME, 'book'),
      fields: {
        id: { refType: BuiltinTypes.NUMBER },
        parent_book_id: { refType: BuiltinTypes.NUMBER },
      },
    })
    const groupType = new ObjectType({
      elemID: new ElemID(ADAPTER_NAME, 'group'),
      fields: {
        name: { refType: BuiltinTypes.STRING },
        fav_recipe: { refType: BuiltinTypes.NUMBER },
      },
    })
    const rootBook = new InstanceElement(
      'rootBook',
      bookType,
      {
        id: 123,
        parent_book_id: 'ROOT',
      },
    )
    const anotherBook = new InstanceElement(
      'book',
      bookType,
      {
        id: 456,
        parent_book_id: new ReferenceExpression(rootBook.elemID, rootBook),
      },
    )
    const recipes = [
      new InstanceElement(
        'recipe123',
        recipeType,
        {
          name: 'recipe123',
          book_id: new ReferenceExpression(rootBook.elemID, rootBook),
        },
      ),
      new InstanceElement(
        'recipe456',
        recipeType,
        {
          name: 'recipe456',
          book_id: new ReferenceExpression(anotherBook.elemID, anotherBook),
        },
      ),
    ]
    const sameRecipeOne = new InstanceElement(
      'sameRecipe',
      recipeType,
      {
        name: '12345',
        book_id: new ReferenceExpression(rootBook.elemID, rootBook),
      },
    )
    const sameRecipeTwo = new InstanceElement(
      'sameRecipe',
      recipeType,
      {
        name: '54321',
        book_id: new ReferenceExpression(rootBook.elemID, rootBook),
      },
    )
    const lastRecipe = new InstanceElement(
      'last',
      recipeType,
      {
        name: 'lastRecipe',
        book_id: new ReferenceExpression(anotherBook.elemID, anotherBook),
      },
      undefined,
      {
        _parent: [new ReferenceExpression(recipes[0].elemID, recipes[0])],
      }
    )
    const groups = [
      new InstanceElement(
        'group1',
        groupType,
        {
          name: 'groupOne',
          fav_recipe: new ReferenceExpression(recipes[0].elemID, recipes[0]),
        },
      ),
      new InstanceElement(
        'group2',
        groupType,
        {
          name: 'groupTwo',
          fav_recipe: new ReferenceExpression(recipes[0].elemID, recipes[0]),
        },
      ),
    ]
    const folderType = new ObjectType({
      elemID: new ElemID(ADAPTER_NAME, 'folder'),
      fields: {
        name: { refType: BuiltinTypes.STRING },
      },
    })
    const folderOne = new InstanceElement(
      'folderOne',
      folderType,
      {
        name: 'Desktop',
      },
      undefined,
      {
        _parent: [new ReferenceExpression(lastRecipe.elemID, lastRecipe)],
      }
    )
    const folderTwo = new InstanceElement(
      'folderTwo',
      folderType,
      {
        name: 'Documents',
      },
      undefined,
      {
        _parent: [new ReferenceExpression(lastRecipe.elemID, lastRecipe)],
      }
    )
    return [recipeType, bookType, ...recipes, anotherBook, rootBook,
      sameRecipeOne, sameRecipeTwo, lastRecipe, groupType, ...groups,
      folderType, folderOne, folderTwo]
  }
  const config = {
    apiDefinitions: {
      types: {
        book: {
          transformation: {
            idFields: ['id', '&parent_book_id'],
          },
        },
        recipe: {
          transformation: {
            idFields: ['name', '&book_id'],
          },
        },
        group: {
          transformation: {
            idFields: ['name'],
          },
        },
        folder: {
          transformation: {
            idFields: ['name'],
            extendsParentId: true,
          },
        },
      },
      typeDefaults: {
        transformation: {
          idFields: ['id'],
        },
      },
      supportedTypes: {},
    },
  }
  let elements: Element[]

  describe('referencedInstanceNames filter', () => {
    type FilterType = FilterWith<'onFetch'>
    let filter: FilterType

    beforeEach(async () => {
      jest.clearAllMocks()
      filter = referencedInstanceNamesFilterCreator()({
        client: {} as unknown,
        paginator: undefined as unknown as Paginator,
        config,
        fetchQuery: createMockQuery(),
      }) as FilterType
    })
    it('should rename the elements correctly when the filter is called', async () => {
      elements = generateElements()
      await filter.onFetch(elements)
      expect(elements
        .filter(isInstanceElement)
        .map(e => e.elemID.getFullName()).sort())
        .toEqual(['myAdapter.book.instance.123_ROOT',
          'myAdapter.book.instance.456_123_ROOT',
          'myAdapter.folder.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT__Desktop',
          'myAdapter.folder.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT__Documents',
          'myAdapter.group.instance.group1',
          'myAdapter.group.instance.group2',
          'myAdapter.recipe.instance.recipe123_123_ROOT',
          'myAdapter.recipe.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT',
          'myAdapter.recipe.instance.recipe456_456_123_ROOT',
          'myAdapter.recipe.instance.sameRecipe',
          'myAdapter.recipe.instance.sameRecipe',
        ])
    })
  })

  describe('addReferencesToInstanceNames function', () => {
    const transformationDefaultConfig = config.apiDefinitions.typeDefaults.transformation
    const transformationConfigByType = {
      recipe: config.apiDefinitions.types.recipe.transformation,
      book: config.apiDefinitions.types.book.transformation,
      group: config.apiDefinitions.types.group.transformation,
      folder: config.apiDefinitions.types.folder.transformation,
    }

    it('should change name and references correctly', async () => {
      elements = generateElements()
      const result = await addReferencesToInstanceNames(
        elements.slice(0, 6).concat(elements.slice(8)),
        transformationConfigByType,
        transformationDefaultConfig
      )
      const sortedResult = result
        .filter(isInstanceElement)
        .map(i => i.elemID.getFullName()).sort()
      expect(result.length).toEqual(13)
      expect(sortedResult)
        .toEqual(['myAdapter.book.instance.123_ROOT',
          'myAdapter.book.instance.456_123_ROOT',
          'myAdapter.folder.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT__Desktop',
          'myAdapter.folder.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT__Documents',
          'myAdapter.group.instance.group1',
          'myAdapter.group.instance.group2',
          'myAdapter.recipe.instance.recipe123_123_ROOT',
          'myAdapter.recipe.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT',
          'myAdapter.recipe.instance.recipe456_456_123_ROOT',
        ])
    })
    it('should not change name for duplicate elemIDs', async () => {
      elements = generateElements()
      const result = await addReferencesToInstanceNames(
        elements.slice(0, 9).concat(elements.slice(12)),
        transformationConfigByType,
        transformationDefaultConfig
      )
      expect(result.length).toEqual(12)
      expect(result
        .map(e => e.elemID.getFullName()).sort())
        .toEqual(['myAdapter.book',
          'myAdapter.book.instance.123_ROOT',
          'myAdapter.book.instance.456_123_ROOT',
          'myAdapter.folder',
          'myAdapter.folder.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT__Desktop',
          'myAdapter.folder.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT__Documents',
          'myAdapter.recipe',
          'myAdapter.recipe.instance.recipe123_123_ROOT',
          'myAdapter.recipe.instance.recipe123_123_ROOT__lastRecipe_456_123_ROOT',
          'myAdapter.recipe.instance.recipe456_456_123_ROOT',
          'myAdapter.recipe.instance.sameRecipe',
          'myAdapter.recipe.instance.sameRecipe',
        ])
    })
    it('should create the correct reference map', () => {
      elements = generateElements()
      const bookOrRecipeIns = elements.filter(isInstanceElement)
        .filter(e => e.elemID.typeName === 'book' || e.elemID.typeName === 'recipe')
        .map(i => i.elemID.getFullName())
      const allIns = elements.filter(isInstanceElement)
      const res = createReferenceIndex(allIns, new Set(bookOrRecipeIns))
      expect(Object.keys(res)).toEqual([
        'myAdapter.book.instance.rootBook',
        'myAdapter.book.instance.book',
        'myAdapter.recipe.instance.recipe123',
        'myAdapter.recipe.instance.last',
      ])
      expect(Object.values(res).map(n => n.length))
        .toEqual([4, 2, 3, 2])
    })
  })
})
