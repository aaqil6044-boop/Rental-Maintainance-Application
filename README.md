# EstateOps — Property Management & Maintenance Platform

Full-stack project: a Spring Boot backend that also serves the web UI, with an
embedded database (H2) so there is nothing extra to install besides Java 21.

## Project structure
```
EstateOps/
├─ README.md
├─ run.bat / run.ps1        ← start the app (downloads Maven for you)
├─ .vscode/                 ← VS Code run config
├─ backend/                 ← Spring Boot app (Java) — THE RUNNABLE PROJECT
│  ├─ pom.xml
│  └─ src/main/
│     ├─ java/com/pmp/…     ← backend code (controllers, services, repos, security)
│     └─ resources/
│        ├─ static/          ← the web UI served at runtime (index/login/app/styles)
│        ├─ schema/          ← MySQL schema (only for the optional prod profile)
│        └─ application*.yml  ← config (dev = embedded H2, prod = MySQL)
└─ frontend/                ← standalone copy of the UI (preview only)
```

The frontend and backend are one running app: open http://localhost:8080 and you get
the website; the pages call the backend's API on the same address.

## Requirements
- Java 21 (JDK). That's all — run.bat downloads Maven automatically.
  Check:  java -version   (should say 21)

## Run it (pick one)
### A) Double-click
Double-click **run.bat**. When it prints "Started Application", open http://localhost:8080

### B) VS Code — terminal
1. File → Open Folder → select this **EstateOps** folder.
2. Terminal → New Terminal →  `.\run.bat`
3. Open http://localhost:8080

### C) VS Code — Run button
1. Install extensions: "Extension Pack for Java" + "Spring Boot Extension Pack".
2. Open  backend/src/main/java/com/pmp/Application.java
3. Click **Run** above `main(...)`  (or use the "Run EstateOps (backend)" launch config).
4. Open http://localhost:8080

## Using it
Landing → Create account → dashboard. The dashboard's "Your properties" list is saved
to and read from the embedded database using your login token. Data persists in
`backend/data/` between runs.

## Stop
Ctrl + C in the terminal (or close the run.bat window).

## Optional: real MySQL instead of H2
1. `mysql -u root -p < backend/src/main/resources/schema/property_maintenance_mysql.sql`
2. Set DB creds + run with `SPRING_PROFILES_ACTIVE=prod` (see backend/docker-compose.yml too).
