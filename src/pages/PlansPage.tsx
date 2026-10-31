import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, Plan, PlanCatalog } from '../types'
import { usePublicView } from '../lib/publicView'
import styles from './PlansPage.module.css'

const DESCRIPTIONS: Record<Plan['key'], string> = {
  free: 'Follow a few bills on your own.',
  single_user: 'Everything, for one person.',
  team: 'Everything, shared by a team.',
  organization: 'Everything, for a large organization.',
}

function dollars(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

function PriceLines({ plan }: { plan: Plan }) {
  if (!plan.annualPrice) {
    return <div className={styles.price}>$0</div>
  }
  const others = [
    plan.monthlyPrice ? `${dollars(plan.monthlyPrice)} a month` : null,
    plan.sessionPassPrice ? `${dollars(plan.sessionPassPrice)} for a session pass` : null,
  ].filter(Boolean)
  return (
    <>
      <div className={styles.price}>
        {dollars(plan.annualPrice)} <span className={styles.per}>a year</span>
      </div>
      {others.length > 0 && <div className={styles.priceNote}>or {others.join(', or ')}</div>}
    </>
  )
}

function featureRows(plan: Plan): { label: string; included: boolean }[] {
  const members =
    plan.memberLimit == null ? 'Unlimited members' : plan.memberLimit === 1 ? '1 person' : `Up to ${plan.memberLimit} members`
  const tracked = plan.trackedBillLimit == null ? 'Unlimited tracked bills' : `Track up to ${plan.trackedBillLimit} bills`
  return [
    { label: 'All bills, hearings, legislators, and committees', included: true },
    { label: tracked, included: true },
    { label: members, included: true },
    { label: 'Email alerts and hearing reminders', included: plan.features.alerts },
    { label: 'AI hearing and amendment summaries', included: plan.features.aiSummaries },
    { label: 'Notes', included: plan.features.notes },
    { label: 'Testimony drafts', included: plan.features.testimony },
  ]
}

function usageLine(catalog: PlanCatalog): string {
  const plan = catalog.plans.find((p) => p.key === catalog.current)
  if (!plan) return ''
  const { trackedBills, members } = catalog.usage
  const tracked =
    plan.trackedBillLimit == null ? `${trackedBills} tracked bills` : `${trackedBills} of ${plan.trackedBillLimit} tracked bills`
  const people = plan.memberLimit == null ? `${members} members` : `${members} of ${plan.memberLimit} members`
  return `${tracked} · ${people}`
}

// A visitor without an account gets the plans with no current plan and no usage.
type Catalog = Pick<PlanCatalog, 'plans'> & Partial<Pick<PlanCatalog, 'current' | 'usage'>>

export function PlansPage() {
  const [catalog, setCatalog] = useState<LoadState<Catalog>>({ status: 'loading' })
  const isPublic = usePublicView()
  const location = useLocation()

  useEffect(() => {
    ;(isPublic ? client.getPublicPlans() : client.getPlans())
      .then((data) => setCatalog({ status: 'ready', data }))
      .catch(() => setCatalog({ status: 'empty' }))
  }, [isPublic])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Plans</h1>
        <p className={styles.subhead}>Every plan can see all of the Legislature's public data. Paid plans add alerts, AI summaries, and team work.</p>
      </div>

      {catalog.status === 'loading' && <div className="skeleton" style={{ height: 320, marginTop: 20 }} />}
      {catalog.status === 'empty' && <p className={styles.subhead}>The plans could not be loaded.</p>}
      {catalog.status === 'ready' && (
        <>
          {catalog.data.current && catalog.data.usage && (
            <p className={styles.usage} data-testid="plan-usage">
              Your workspace has the <b>{catalog.data.plans.find((p) => p.key === catalog.data.current)?.label}</b> plan:{' '}
              {usageLine(catalog.data as PlanCatalog)}
            </p>
          )}

          <div className={styles.grid}>
            {catalog.data.plans.map((plan) => {
              const current = plan.key === catalog.data.current
              return (
                <section
                  key={plan.key}
                  className={`${styles.card} ${current ? styles.cardCurrent : ''}`}
                  aria-label={`${plan.label} plan`}
                >
                  <div className={styles.cardHead}>
                    <h2 className={styles.planName}>{plan.label}</h2>
                    {current && <span className={styles.currentBadge}>Your plan</span>}
                  </div>
                  <p className={styles.description}>{DESCRIPTIONS[plan.key]}</p>
                  <PriceLines plan={plan} />
                  <ul className={styles.features}>
                    {featureRows(plan).map((row) => (
                      <li key={row.label} className={row.included ? styles.included : styles.excluded}>
                        <span className={styles.mark} aria-hidden="true">
                          {row.included ? '✓' : '✕'}
                        </span>
                        <span>
                          {row.label}
                          {!row.included && <span className="visually-hidden"> (not included)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>

          <div className={styles.footer}>
            <p>Nonprofit organizations get 40% off each paid plan.</p>
            {isPublic ? (
              <>
                <p>A new account starts on the Free plan. Online payment is not available yet. To change your plan, contact the Rotunda Board team.</p>
                <p className={styles.signupRow}>
                  <Link to="/signup" state={{ from: location }} className={styles.signup}>
                    Sign up free
                  </Link>
                </p>
              </>
            ) : (
              <p>Online payment is not available yet. To change your plan, contact the Rotunda Board team.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
