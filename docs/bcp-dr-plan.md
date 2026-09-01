# Business Continuity & Disaster Recovery Plan -- RIS Platform

## Recovery Objectives

- **RTO (Recovery Time Objective)**: 4 hours
- **RPO (Recovery Point Objective)**: 1 hour (WAL archiving every 15 minutes)

## Backup Strategy

### Database (PostgreSQL)

- **Daily full backup**: pg_dump at 02:00 EAT, stored encrypted
- **WAL archiving**: Every 15 minutes to backup storage
- **Retention**: 30 days for daily backups, 7 days for WAL archives
- **Verification**: Monthly restore test to staging environment

### Redis

- RDB snapshots every 15 minutes
- AOF persistence enabled for sub-second RPO

### Application

- Docker images stored in GitHub Container Registry (GHCR)
- Configuration in environment variables (never in images)
- Infrastructure as Code via docker-compose

## Failover Procedures

1. **Database failure**: Promote standby replica (if configured)
2. **Application failure**: Docker Swarm auto-restart (restart policy: on-failure)
3. **Redis failure**: Application falls back to database-only mode (degraded)

## Incident Response

1. Detect: Health endpoint returns 503 -> PagerDuty/Slack alert
2. Assess: Check /health endpoint, database connectivity, Redis status
3. Respond: Follow failover procedures above
4. Notify: Bank of Uganda within 24 hours if outage > 2 hours (per BoU guidelines)
5. Review: Post-incident review within 48 hours

## Communication Plan

| Stakeholder    | Channel          | SLA        |
| -------------- | ---------------- | ---------- |
| Engineering    | Slack #incidents | Immediate  |
| Management     | Email + Phone    | 30 minutes |
| Bank of Uganda | Official letter  | 24 hours   |
| Affected users | Email + SMS      | 2 hours    |

## Testing Schedule

- **Quarterly**: Database restore test to staging
- **Semi-annually**: Full disaster recovery drill
- **Annually**: BCP plan review and update

## Document Control

- Owner: CTO
- Last updated: [DATE]
- Next review: [DATE + 12 months]
