| Endpoint | RSOP | RBP | RSOM | RSA | RSO |
|---|---|---|---|---|---|
| GET /tracking | 200 | 200 | 403 | 403 | 403 |
| POST /tracking | 400 | 403 | 403 | 403 | 403 |
| GET /budgets | 403 | 404 | 403 | 403 | 403 |
| GET /approvals?limit=1 | 403 | 403 | 200 | 403 | 403 |
| GET /vehicles?limit=1 | 403 | 200 | 403 | 403 | 403 |
| GET /drivers?limit=1 | 403 | 200 | 403 | 403 | 403 |
| GET /vehicle-allotments/projects?limit=1 | 403 | 200 | 403 | 403 | 403 |
| GET /rsa-clearances?limit=1 | 403 | 403 | 403 | 200 | 403 |
| GET /on-road-vehicles?limit=1 | 403 | 200 | 403 | 403 | 403 |
| GET /rsa/payments?limit=1 | 403 | 403 | 403 | 200 | 403 |
| GET /settlements?limit=1 | 403 | 200 | 200 | 200 | 200 |
| GET /settlements?scope=all&limit=1 | 403 | 200 | 200 | 200 | 200 |
| GET /settlements/projects?limit=1 | 403 | 200 | 403 | 200 | 403 |
| POST /settlements/projects/:id/daily | 403 | 404 | 403 | 404 | 403 |
| POST /settlements/:id/approve | 403 | 403 | 404 | 403 | 404 |
| POST /settlements/:id/complete | 403 | 403 | 403 | 404 | 403 |
| GET /settlements/export/approved | 403 | 403 | 403 | 200 | 403 |
| GET /settlements/reports/driver-list | 403 | 403 | 403 | 403 | 200 |
| GET /settlements/:id/salary-pdf | 403 | 403 | 403 | 404 | 404 |

No token -> GET /settlements: 401
