import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as client from '../data/client'
import { useAuth } from '../auth/AuthContext'
import type { LoadState, Role, WorkspaceInvite, WorkspaceMemberDetail } from '../types'
import { InitialsSquare } from '../components/shared/InitialsSquare'
import { EmptyState } from '../components/shared/EmptyState'
import { useConfirm } from '../hooks/useConfirm'
import styles from './SettingsPage.module.css'

function InviteForm({ onCreate }: { onCreate: (email: string, role: Role) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(email.trim(), role)
      setEmail('')
      setRole('member')
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not send this invite.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.inviteForm} onSubmit={handleSubmit}>
      <input
        className={styles.formInput}
        type="email"
        placeholder="teammate@example.org"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <select className={styles.roleSelect} value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button className={styles.inviteButton} type="submit" disabled={saving}>
        {saving ? 'Sending…' : 'Send invite'}
      </button>
      {error && <div className={styles.formError}>{error}</div>}
    </form>
  )
}

function WorkspaceSection({
  isAdmin,
  workspaceName,
  onRename,
}: {
  isAdmin: boolean
  workspaceName: string
  onRename: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(workspaceName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setName(workspaceName), [workspaceName])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === workspaceName) return
    setSaving(true)
    setError(null)
    try {
      await onRename(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not rename this workspace.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Workspace</h2>
      {isAdmin ? (
        <form className={styles.inviteForm} onSubmit={handleSave}>
          <input className={styles.formInput} value={name} onChange={(e) => setName(e.target.value)} required />
          <button className={styles.inviteButton} type="submit" disabled={saving || !name.trim() || name.trim() === workspaceName}>
            {saving ? 'Saving…' : 'Rename'}
          </button>
          {error && <div className={styles.formError}>{error}</div>}
        </form>
      ) : (
        <p className={styles.subhead}>{workspaceName}</p>
      )}
    </section>
  )
}

function DangerZoneSection({
  workspaceName,
  onDelete,
}: {
  workspaceName: string
  onDelete: () => Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Danger zone</h2>
      <div className={styles.dangerZone}>
        <div>
          <div className={styles.dangerTitle}>Delete this workspace</div>
          <p className={styles.dangerText}>
            Permanently deletes {workspaceName} and everything tracked in it — bills, notes, testimony,
            saved views. This can't be undone.
          </p>
        </div>
        <input
          className={styles.formInput}
          placeholder={`Type "${workspaceName}" to confirm`}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
        <button
          className={styles.dangerButton}
          disabled={confirmText !== workspaceName || deleting}
          onClick={handleDelete}
        >
          {deleting ? 'Deleting…' : 'Delete workspace'}
        </button>
      </div>
    </section>
  )
}

export function SettingsPage() {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = session?.role === 'admin'
  const workspaceId = session?.currentWorkspace?.id ?? null
  const currentUserId = session ? String(session.user.id) : null

  const [members, setMembers] = useState<LoadState<WorkspaceMemberDetail[]>>({ status: 'loading' })
  const [invites, setInvites] = useState<LoadState<WorkspaceInvite[]>>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const loadMembers = () => {
    if (!workspaceId) return
    client
      .getDetailedWorkspaceMembers(workspaceId)
      .then((data) => setMembers(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setMembers({ status: 'empty' }))
  }

  const loadInvites = () => {
    if (!workspaceId) return
    client
      .getWorkspaceInvites(workspaceId)
      .then((data) => setInvites(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setInvites({ status: 'empty' }))
  }

  useEffect(() => {
    loadMembers()
    loadInvites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const handleCreateInvite = async (email: string, role: Role) => {
    if (!workspaceId) return
    await client.createInvite(workspaceId, email, role)
    setNotice(`Invite sent to ${email}.`)
    loadInvites()
  }

  const handleRevoke = async (invite: WorkspaceInvite) => {
    if (!workspaceId) return
    if (!(await confirm(`Revoke the invite for ${invite.email}?`, { confirmLabel: 'Revoke' }))) return
    await client.revokeInvite(workspaceId, invite.id)
    loadInvites()
  }

  const handleResend = async (invite: WorkspaceInvite) => {
    if (!workspaceId) return
    await client.resendInvite(workspaceId, invite.id)
    setNotice(`Invite re-sent to ${invite.email}.`)
    loadInvites()
  }

  const handleRename = async (name: string) => {
    if (!workspaceId) return
    await client.renameWorkspace(workspaceId, name)
    setNotice('Workspace renamed.')
    // The name shown in the TopBar/switcher comes from the auth session —
    // a full reload is the simplest way to keep it in sync everywhere,
    // same reasoning as switchWorkspace().
    window.location.href = '/'
  }

  const handleDeleteWorkspace = async () => {
    if (!workspaceId) return
    const { nextWorkspaceId } = await client.deleteWorkspace(workspaceId)
    if (nextWorkspaceId) {
      window.location.href = '/'
    } else {
      await logout()
      navigate('/signup', { replace: true })
    }
  }

  const handleRoleChange = async (member: WorkspaceMemberDetail, role: Role) => {
    if (!workspaceId) return
    try {
      await client.updateMemberRole(workspaceId, member.id, role)
      setNotice(`${member.name} is now ${role === 'admin' ? 'an admin' : 'a member'}.`)
      loadMembers()
    } catch (err) {
      setNotice(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not change this role.')
    }
  }

  const handleRemoveMember = async (member: WorkspaceMemberDetail) => {
    if (!workspaceId) return
    if (!(await confirm(`Remove ${member.name} from this workspace?`, { confirmLabel: 'Remove' }))) return
    try {
      await client.removeMember(workspaceId, member.id)
      setNotice(`${member.name} was removed.`)
      loadMembers()
    } catch (err) {
      setNotice(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not remove this member.')
    }
  }

  return (
    <div className={styles.page}>
      {confirmDialog}
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subhead}>
          {session?.currentWorkspace?.name ?? 'Your workspace'} — manage who's on your team and who's been invited.
        </p>
      </div>

      {notice && <div className={styles.notice}>{notice}</div>}

      {session?.currentWorkspace && (
        <WorkspaceSection isAdmin={isAdmin} workspaceName={session.currentWorkspace.name} onRename={handleRename} />
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Team</h2>
        {members.status === 'loading' && <div className="skeleton" style={{ height: 120, marginTop: 12 }} />}
        {members.status === 'empty' && <EmptyState message="No team members found." />}
        {members.status === 'ready' && (
          <div className={styles.memberList}>
            {members.data.map((m) => (
              <div key={m.id} className={styles.memberRow}>
                <InitialsSquare member={m} size={24} />
                <span className={styles.memberName}>{m.name}</span>
                <span className={styles.memberEmail}>{m.email}</span>
                {isAdmin && m.id !== currentUserId ? (
                  <>
                    <select
                      className={styles.roleSelect}
                      value={m.role}
                      onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                      aria-label={`Role for ${m.name}`}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button className={styles.textButton} onClick={() => handleRemoveMember(m)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <span className={styles.inviteRole}>{m.role}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Invite someone</h2>
          <InviteForm onCreate={handleCreateInvite} />
        </section>
      )}

      {isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pending invites</h2>
          {invites.status === 'loading' && <div className="skeleton" style={{ height: 80, marginTop: 12 }} />}
          {invites.status === 'empty' && <EmptyState message="No pending invites." />}
          {invites.status === 'ready' && (
            <div className={styles.inviteList}>
              {invites.data.map((inv) => (
                <div key={inv.id} className={styles.inviteRow}>
                  <span className={styles.inviteEmail}>{inv.email}</span>
                  <span className={styles.inviteRole}>{inv.role}</span>
                  <span className={styles.inviteExpires}>
                    expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  <button className={styles.textButton} onClick={() => handleResend(inv)}>
                    Resend
                  </button>
                  <button className={styles.textButton} onClick={() => handleRevoke(inv)}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isAdmin && session?.currentWorkspace && (
        <DangerZoneSection workspaceName={session.currentWorkspace.name} onDelete={handleDeleteWorkspace} />
      )}
    </div>
  )
}
