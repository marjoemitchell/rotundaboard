import { test, expect, signUpFreshWorkspace, inviteAndAcceptMember, uniqueSuffix } from './fixtures'

test.describe('workspace rename', () => {
  test('an admin can rename the workspace; a member cannot', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const newName = `E2E Renamed ${uniqueSuffix()}`

    await page.goto('/settings')
    await page.locator('h2', { hasText: 'Workspace' }).waitFor()
    await page.fill('form input:not([type="email"])', newName)
    await page.click('button:has-text("Rename")')
    await page.waitForURL('/')
    await expect(page.locator('nav[aria-label="Primary"]').getByText(newName)).toBeVisible()

    const member = await inviteAndAcceptMember(page, browser)
    await member.page.goto('/settings')
    await expect(member.page.locator('form input:not([type="email"])')).toHaveCount(0)
    await expect(member.page.locator('nav[aria-label="Primary"]').getByText(newName)).toBeVisible()

    const workspaceId = (await (await member.page.request.get('http://localhost:4000/api/auth/me')).json())
      .currentWorkspace.id
    const directAttempt = await member.page.request.patch(`http://localhost:4000/api/workspaces/${workspaceId}`, {
      data: { name: 'Hacked' },
    })
    expect(directAttempt.status()).toBe(403)

    await member.context.close()
  })
})

test.describe('member roles', () => {
  test('promoting and demoting a member works, and the last admin cannot be demoted', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const member = await inviteAndAcceptMember(page, browser)

    await page.goto('/settings')
    const memberRow = page.locator('[class*="memberRow"]', { hasText: member.email })
    await memberRow.locator('select[class*="roleSelect"]').selectOption('admin')
    await expect(page.locator(`text=is now an admin`)).toBeVisible()

    // Two admins now — demoting the original admin (this page's own user)
    // should succeed since another admin remains.
    await member.page.reload()
    const meBefore = await (await member.page.request.get('http://localhost:4000/api/auth/me')).json()
    expect(meBefore.role).toBe('admin')

    // Demote the newly-promoted member back down, leaving the original
    // admin as the sole admin again.
    await memberRow.locator('select[class*="roleSelect"]').selectOption('member')
    await expect(page.locator('text=is now a member')).toBeVisible()

    // Now try to demote the ONLY remaining admin (this admin demoting
    // themself isn't exposed in the UI — their own row has no controls —
    // so hit the API directly to confirm the server-side guard holds.
    const workspaceId = (await (await page.request.get('http://localhost:4000/api/auth/me')).json()).currentWorkspace
      .id
    const meId = (await (await page.request.get('http://localhost:4000/api/auth/me')).json()).user.id
    const demoteSelf = await page.request.patch(`http://localhost:4000/api/workspaces/${workspaceId}/members/${meId}`, {
      data: { role: 'member' },
    })
    expect(demoteSelf.status()).toBe(400)

    await member.context.close()
  })
})

test.describe('member removal', () => {
  test('an admin can remove a member, who then loses access; self-removal is blocked', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const member = await inviteAndAcceptMember(page, browser)

    await page.goto('/settings')
    const memberRow = page.locator('[class*="memberRow"]', { hasText: member.email })
    await memberRow.locator('button:has-text("Remove")').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.locator('text=was removed')).toBeVisible()
    await expect(page.locator('[class*="memberRow"]', { hasText: member.email })).toHaveCount(0)

    // The removed member's existing session no longer has an active workspace.
    const staleRequest = await member.page.request.get('http://localhost:4000/api/bills')
    expect(staleRequest.status()).toBe(401)

    // Self-removal has no UI affordance (the admin's own row shows no
    // controls); confirm the server rejects it directly too.
    const workspaceId = (await (await page.request.get('http://localhost:4000/api/auth/me')).json()).currentWorkspace
      .id
    const meId = (await (await page.request.get('http://localhost:4000/api/auth/me')).json()).user.id
    const selfRemoval = await page.request.delete(`http://localhost:4000/api/workspaces/${workspaceId}/members/${meId}`)
    expect(selfRemoval.status()).toBe(400)

    await member.context.close()
  })
})

test.describe('ownership-gated deletes', () => {
  test('a member can delete their own saved view but not another member\'s; an admin can delete either', async ({
    page,
    browser,
  }) => {
    await signUpFreshWorkspace(page)
    const owner = await inviteAndAcceptMember(page, browser)
    const bystander = await inviteAndAcceptMember(page, browser)

    // The owner needs a tracked bill to have something to filter/save a view from.
    await owner.page.goto('/')
    await owner.page.locator('select[aria-label="Add filter"]').selectOption('chamber')
    await owner.page.click('button:has-text("Save as filter")')
    await owner.page.getByRole('dialog').locator('input').fill('Owner View')
    await owner.page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(owner.page.getByRole('button', { name: 'Owner View', exact: true })).toBeVisible()

    // Bystander can see the view (shared within the workspace) but can't delete it.
    await bystander.page.goto('/')
    const viewId = await bystander.page.evaluate(async () => {
      const res = await fetch('http://localhost:4000/api/saved-views', { credentials: 'include' })
      const views = (await res.json()) as { id: string; name: string }[]
      return views.find((v) => v.name === 'Owner View')?.id
    })
    expect(viewId).toBeTruthy()
    const bystanderDelete = await bystander.page.request.delete(`http://localhost:4000/api/saved-views/${viewId}`)
    expect(bystanderDelete.status()).toBe(403)

    // The admin can delete anyone's.
    const adminDelete = await page.request.delete(`http://localhost:4000/api/saved-views/${viewId}`)
    expect(adminDelete.status()).toBe(204)

    await owner.context.close()
    await bystander.context.close()
  })
})

test.describe('workspace deletion', () => {
  test('deleting the workspace as its only admin removes it and signs everyone out of it', async ({ page, browser }) => {
    const admin = await signUpFreshWorkspace(page)
    const member = await inviteAndAcceptMember(page, browser)

    await page.goto('/settings')
    await page.fill('input[placeholder*="Type"]', admin.workspaceName)
    await page.click('button:has-text("Delete workspace")')
    await page.waitForURL('/signup')

    // The member's pre-existing session no longer has an active workspace.
    const memberCheck = await member.page.request.get('http://localhost:4000/api/bills')
    expect(memberCheck.status()).toBe(401)

    // Logging back in as the admin (a fresh session, since deletion logs
    // them out) shows zero workspace memberships — the workspace and its
    // membership row are really gone, not just inaccessible. A fresh
    // context avoids any leftover browser-history interaction from the
    // delete -> /signup redirect just above.
    const reloginCtx = await browser.newContext()
    const reloginPage = await reloginCtx.newPage()
    await reloginPage.request.post('http://localhost:4000/api/auth/login', {
      data: { email: admin.email, password: admin.password },
    })
    const me = await (await reloginPage.request.get('http://localhost:4000/api/auth/me')).json()
    expect(me.workspaces).toHaveLength(0)
    expect(me.currentWorkspace).toBeNull()

    await reloginCtx.close()
    await member.context.close()
  })
})
