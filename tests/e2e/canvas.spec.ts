/**
 * Canvas e2e — OWNER: worker-2. Covers docs/briefs/worker-2-canvas.md "Done when".
 * Drives the real app shell and reads the store through `window.__erd` (set when `?e2e`).
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const tableNames = (page: Page) => page.evaluate(() => window.__erd!.store.getState().schema.tables.map((t) => t.name))
const refCount = (page: Page) => page.evaluate(() => window.__erd!.store.getState().schema.refs.length)

const node = (page: Page, name: string) => page.locator(`[data-testid="table-node"][data-table-name="${name}"]`)
const rfNode = (page: Page, name: string) => page.locator('.react-flow__node', { has: node(page, name) })
const row = (page: Page, table: string, column: string) =>
  node(page, table).locator(`[data-testid="column-row"][data-column-name="${column}"]`)

/** Fresh app with an empty store, canvas mounted. */
async function boot(page: Page) {
  await page.goto('/?e2e')
  await page.evaluate(() => {
    localStorage.clear()
    window.__erd!.store.getState().reset()
  })
  const blank = page.getByTestId('start-blank')
  if (await blank.isVisible().catch(() => false)) await blank.click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('canvas-toolbar')).toBeVisible()
}

/** Seed users/posts/tags (posts.author_id → users.id) with known positions through the store. */
async function seedBlogLike(page: Page) {
  await page.evaluate(() => {
    const st = window.__erd!.store.getState()
    const col = (id: string, name: string, type: string, pk = false) => ({
      id,
      name,
      type,
      pk,
      unique: false,
      notNull: pk,
      increment: pk,
    })
    st.update('canvas', (d) => {
      d.tables.push(
        { id: 'users', name: 'users', columns: [col('users.id', 'id', 'int', true), col('users.email', 'email', 'varchar(254)')], indexes: [] },
        { id: 'posts', name: 'posts', columns: [col('posts.id', 'id', 'int', true), col('posts.author_id', 'author_id', 'int')], indexes: [] },
        { id: 'tags', name: 'tags', columns: [col('tags.id', 'id', 'int', true), col('tags.name', 'name', 'varchar(50)')], indexes: [] },
      )
      d.refs.push({
        id: 'r_posts_users',
        kind: '>',
        from: { tableId: 'posts', columnIds: ['posts.author_id'] },
        to: { tableId: 'users', columnIds: ['users.id'] },
      })
    })
    st.setLayout({ users: { x: 0, y: 0 }, posts: { x: 400, y: 0 }, tags: { x: 800, y: 0 } })
  })
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await page.getByTestId('tb-fit').click()
  await page.waitForTimeout(400) // fitView animation
}

async function dragBetween(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (!a || !b) throw new Error('handle not laid out')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

test.describe('canvas', () => {
  test('Add table creates a node with an id column; Add column adds a row', async ({ page }) => {
    await boot(page)
    await page.getByTestId('tb-add-table').click()
    await expect(page.getByTestId('table-node')).toHaveCount(1)
    await expect(tableNames(page)).resolves.toEqual(['table_1'])
    // An empty table is a DBML error, so the new table is seeded with an id pk column.
    await expect(page.getByTestId('column-row')).toHaveCount(1)
    await expect(row(page, 'table_1', 'id').getByTestId('badge-pk')).toBeVisible()
    await expect(page.getByTestId('inspector')).toBeVisible()

    await page.getByTestId('inspector-add-column').click()
    await expect(page.getByTestId('column-row')).toHaveCount(2)
    await expect(page.getByTestId('inspector-column')).toHaveCount(2)
    const cols = await page.evaluate(() => window.__erd!.store.getState().schema.tables[0].columns.map((c) => c.name))
    expect(cols).toEqual(['id', 'column_1'])
    // Canvas diagnostics: no errors for a well-formed table.
    const errors = await page.evaluate(() => window.__erd!.store.getState().diagnostics.canvas.filter((d) => d.severity === 'error').length)
    expect(errors).toBe(0)
  })

  test('keyboard-only: after Add table, create 3 columns without the mouse', async ({ page }) => {
    await boot(page)
    await page.getByTestId('tb-add-table').click()
    // Focus lands in the table-name field with its text selected.
    await expect(page.getByTestId('inspector-table-name')).toBeFocused()
    await page.keyboard.type('users')
    await page.keyboard.press('Enter') // → last column's name (id)
    await expect(page.getByTestId('inspector-col-name').last()).toBeFocused()
    await page.keyboard.press('Enter') // Enter on the last row adds a new row and focuses its name
    await expect(page.getByTestId('inspector-column')).toHaveCount(2)
    await page.keyboard.type('email')
    await page.keyboard.press('Tab') // → type
    await expect(page.getByTestId('inspector-col-type').last()).toBeFocused()
    await page.keyboard.type('varchar(254)')
    await page.keyboard.press('Enter') // Enter from the type field of the last row also adds a row
    await page.keyboard.type('age')
    await page.keyboard.press('Enter')
    await page.keyboard.type('bio')
    await page.keyboard.press('Escape') // blur

    await expect
      .poll(() => page.evaluate(() => window.__erd!.store.getState().schema.tables[0].columns.map((c) => [c.name, c.type])))
      .toEqual([
        ['id', 'int'],
        ['email', 'varchar(254)'],
        ['age', 'varchar(255)'],
        ['bio', 'varchar(255)'],
      ])
    await expect(tableNames(page)).resolves.toEqual(['users'])
    await expect(page.getByTestId('column-row')).toHaveCount(4)

    // Delete on an empty new row removes it.
    await page.getByTestId('inspector-col-name').last().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-column')).toHaveCount(5)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace') // clears the auto name
    await page.keyboard.press('Backspace') // empty blank row → removed
    await expect(page.getByTestId('inspector-column')).toHaveCount(4)
  })

  test('drag a column handle from A to B creates a ref edge', async ({ page }) => {
    await boot(page)
    await seedBlogLike(page)
    // remove the seeded ref so we start from zero
    await page.evaluate(() =>
      window.__erd!.store.getState().update('canvas', (d) => {
        d.refs = []
      }),
    )
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)

    const from = row(page, 'tags', 'name').getByTestId('handle-L')
    const to = row(page, 'posts', 'id').getByTestId('handle-R')
    await row(page, 'tags', 'name').hover()
    await dragBetween(page, from, to)

    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    expect(await refCount(page)).toBe(1)
    const ref = await page.evaluate(() => window.__erd!.store.getState().schema.refs[0])
    expect(ref.kind).toBe('>')
    expect(ref.from).toEqual({ tableId: 'tags', columnIds: ['tags.name'] })
    expect(ref.to).toEqual({ tableId: 'posts', columnIds: ['posts.id'] })
    await expect(page.getByTestId('edge-label')).toHaveText('*..1')
    // FK badge appears on the new fk column; type mismatch (varchar vs int) is a canvas warning.
    await expect(row(page, 'tags', 'name').getByTestId('badge-fk')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => window.__erd!.store.getState().diagnostics.canvas.filter((d) => d.severity === 'warning').length))
      .toBe(1)

    // The new edge is selected and its inspector + floating toolbar are shown.
    await expect(page.getByTestId('inspector-ref')).toBeVisible()
    await expect(page.getByTestId('edge-toolbar')).toBeVisible()
    await page.getByTestId('edge-kind').selectOption('-')
    await expect(page.getByTestId('edge-label')).toHaveText('1..1')

    // Dragging the same pair again is rejected (duplicate). Close the inspector first so it
    // does not sit over the right-hand node.
    await page.getByTestId('inspector-close').click()
    await expect(page.getByTestId('inspector')).toBeHidden()
    await row(page, 'tags', 'name').hover()
    await dragBetween(page, from, to)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    expect(await refCount(page)).toBe(1)
  })

  test('changing a type in the inspector updates the node row; positions persist in the store and across reload', async ({ page }) => {
    await boot(page)
    await seedBlogLike(page)
    // One click only selects; the edit panel opens on double click.
    await node(page, 'users').getByTestId('table-header').click()
    await expect(page.getByTestId('inspector-table')).toBeHidden()
    await node(page, 'users').getByTestId('table-header').dblclick()
    await expect(page.getByTestId('inspector-table')).toBeVisible()
    await expect(page.getByTestId('inspector-table-name')).toHaveValue('users')

    const typeInput = page.getByTestId('inspector-column').nth(1).getByTestId('inspector-col-type')
    await typeInput.fill('text')
    await expect(row(page, 'users', 'email').locator('.erd-row__type')).toHaveText('text')
    // Suggestions filter as you type.
    await typeInput.fill('time')
    await expect(page.getByTestId('type-suggestions').getByRole('option')).toHaveCount(3)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(typeInput).toHaveValue('timestamp')
    await expect(row(page, 'users', 'email').locator('.erd-row__type')).toHaveText('timestamp')

    // Drag the users node (inspector closed so nothing overlays the canvas) and check the store.
    await page.getByTestId('inspector-close').click()
    await expect(page.getByTestId('inspector')).toBeHidden()
    const before = await page.evaluate(() => window.__erd!.store.getState().layout.users)
    const header = node(page, 'users').getByTestId('table-header')
    const box = (await header.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 90, { steps: 8 })
    await page.mouse.up()
    const after = await page.evaluate(() => window.__erd!.store.getState().layout.users)
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)

    // Autosave writes the tab's active project → reload keeps positions.
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('erd-maker:project:'))))
      .toBe(true)
    await page.waitForTimeout(700)
    await page.reload()
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    await expect.poll(() => page.evaluate(() => window.__erd!.store.getState().layout.users)).toEqual(after)
  })

  test('undo reverts the last canvas patch (toolbar and Ctrl+Z)', async ({ page }) => {
    await boot(page)
    await page.getByTestId('tb-add-table').click()
    await expect(page.getByTestId('table-node')).toHaveCount(1)
    await page.getByTestId('tb-undo').click()
    await expect(page.getByTestId('table-node')).toHaveCount(0)
    await expect(tableNames(page)).resolves.toEqual([])
    await page.getByTestId('tb-redo').click()
    await expect(page.getByTestId('table-node')).toHaveCount(1)

    // Typing a name is one undo step per edit session.
    await page.getByTestId('inspector-table-name').fill('orders')
    await expect(tableNames(page)).resolves.toEqual(['orders'])
    await page.keyboard.press('Escape')
    await page.getByTestId('canvas').click({ position: { x: 30, y: 300 } })
    await page.keyboard.press('Control+z')
    await expect.poll(() => tableNames(page)).toEqual(['table_1'])
  })

  test('Ctrl+Shift+T adds a table; Delete removes the selected table', async ({ page }) => {
    await boot(page)
    await page.getByTestId('canvas').click({ position: { x: 30, y: 300 } })
    await page.keyboard.press('Control+Shift+T')
    await expect(page.getByTestId('table-node')).toHaveCount(1)
    await page.keyboard.press('Escape') // leave the inspector input
    await node(page, 'table_1').getByTestId('table-header').click()
    await expect(rfNode(page, 'table_1')).toHaveClass(/selected/)
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('table-node')).toHaveCount(0)
    await expect(tableNames(page)).resolves.toEqual([])
  })

  test('hovering a table highlights exactly its connected nodes and edges', async ({ page }) => {
    await boot(page)
    await seedBlogLike(page)
    const posts = rfNode(page, 'posts')
    const users = rfNode(page, 'users')
    const tags = rfNode(page, 'tags')
    const edge = page.locator('.react-flow__edge')

    await expect(page.locator('.react-flow__node.highlighted')).toHaveCount(0)
    await node(page, 'posts').getByTestId('table-header').hover()
    await expect(posts).toHaveClass(/highlighted/)
    await expect(users).toHaveClass(/highlighted/)
    await expect(tags).toHaveClass(/dimmed/)
    await expect(edge).toHaveClass(/highlighted/)
    await expect(page.locator('.react-flow__node.highlighted')).toHaveCount(2)
    // Store highlight mirrors the node set (for other views).
    const hl = await page.evaluate(() => [...window.__erd!.store.getState().highlight].sort())
    expect(hl).toEqual(['posts', 'users'])

    // Hovering an unconnected table highlights only itself.
    await node(page, 'tags').getByTestId('table-header').hover()
    await expect(tags).toHaveClass(/highlighted/)
    await expect(posts).toHaveClass(/dimmed/)
    await expect(users).toHaveClass(/dimmed/)
    await expect(edge).toHaveClass(/dimmed/)

    // Leaving clears it.
    await page.mouse.move(5, 400)
    await expect(page.locator('.react-flow__node.highlighted')).toHaveCount(0)
    await expect(page.locator('.react-flow__node.dimmed')).toHaveCount(0)

    // Clicking pins the highlight; Escape clears it.
    await node(page, 'users').getByTestId('table-header').click()
    await page.mouse.move(5, 400)
    await expect(users).toHaveClass(/highlighted/)
    await expect(posts).toHaveClass(/highlighted/)
    await expect(tags).toHaveClass(/dimmed/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.react-flow__node.dimmed')).toHaveCount(0)
    await expect(page.getByTestId('inspector')).toBeHidden()
  })

  test('auto-layout positions every table without overlap', async ({ page }) => {
    await boot(page)
    await seedBlogLike(page)
    await page.evaluate(() => window.__erd!.store.getState().setLayout({ users: { x: 0, y: 0 }, posts: { x: 0, y: 0 }, tags: { x: 0, y: 0 } }))
    await page.getByTestId('tb-auto-layout').click()
    await expect
      .poll(async () => {
        const l = await page.evaluate(() => window.__erd!.store.getState().layout)
        const pts = Object.values(l).map((p) => `${p.x},${p.y}`)
        return new Set(pts).size
      })
      .toBe(3)
    const l = await page.evaluate(() => window.__erd!.store.getState().layout)
    // Layered RIGHT: the referenced table (users) sits to the right of the fk table (posts).
    expect(l.users.x).toBeGreaterThan(l.posts.x)
  })
})
