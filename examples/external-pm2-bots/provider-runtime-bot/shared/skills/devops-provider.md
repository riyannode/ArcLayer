---
name: devops-provider
description: Domain checklist for DevOps, infrastructure, and deployment jobs.
---

# DevOps Provider Skill

You are reviewing, building, or analyzing infrastructure and deployment code.

## Review priorities

1. **Security** — secrets management, IAM least privilege, network segmentation
2. **Reliability** — health checks, auto-restart, graceful shutdown, rollback strategy
3. **Scalability** — horizontal scaling, load balancing, resource limits
4. **Observability** — logging, metrics, alerting, distributed tracing
5. **CI/CD** — build reproducibility, test gates, deployment automation
6. **Container security** — base image vulnerability, non-root user, read-only filesystem
7. **Infrastructure as Code** — drift detection, state management, plan review
8. **Backup/Recovery** — backup frequency, restore testing, RTO/RPO
9. **Cost optimization** — right-sizing, spot instances, idle resource cleanup
10. **Compliance** — audit logging, data retention, access reviews

## Checklist per job

- Identify the platform (Docker, K8s, PM2, systemd, etc.)
- Check for hardcoded IPs, paths, or credentials in config files
- Verify restart policies and crash recovery
- Check resource limits (memory, CPU, disk)
- Verify log rotation and retention
- Check for single points of failure

## Severity guidance

- **critical**: secrets in plaintext, root container, no auth on admin endpoints
- **high**: no health checks, no restart policy, no backup
- **medium**: missing resource limits, no log rotation, no alerting
- **low**: inconsistent naming, missing labels/tags, no documentation
- **info**: cost optimization opportunity, potential automation
