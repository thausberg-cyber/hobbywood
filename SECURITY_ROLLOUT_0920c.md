# 0.9.20c – abgesicherter Tester-Neustart (Staging)

Status: **Noch nicht veröffentlicht.** Dieser Zweig ist zur Vorbereitung bestimmt. `main`, die bisherige Testadresse und das laufende Render-Backend bleiben zunächst unverändert.

## Veröffentlichungssperre

- [ ] Altstand des bestehenden Backends und Render-Umgebung sichern (keine Geheimnisse ins Repository).
- [ ] Aktuelle 0.9.20c-Eigentümerdateien gegen den produktiven Stand prüfen; Frontend, Backend und Cache-Version gemeinsam übernehmen.
- [ ] Separaten Render-Staging-Service mit eigener URL einrichten; `OPENAI_API_KEY` ausschließlich als Render-Umgebungsvariable.
- [ ] Tester-Zugangscodes lokal erzeugen; ausschließlich SHA-256-Hashes in `TESTER_KEY_HASHES_JSON` des Staging-Services. Rohcodes niemals committen.
- [ ] `TESTER_HOURLY_LIMIT=20`, `TESTER_DAILY_LIMIT=60`, `GLOBAL_DAILY_LIMIT=200`, `TESTER_CONCURRENT_LIMIT=2`, `GLOBAL_CONCURRENT_LIMIT=8` setzen. Die In-Memory-Limits sind nur für eine einzelne Instanz belastbar.
- [ ] `ALLOWED_ORIGINS` auf die konkrete Vorschauadresse begrenzen. CORS ersetzt keine Authentifizierung.
- [ ] Separates HTTPS-Frontend mit richtiger Staging-API-URL und vorhandenem `tree-ring-bg.jpg` bereitstellen; nicht die bisherige Testadresse überschreiben.
- [ ] Unbekannter/falscher/gesperrter Zugangscode: 401; erlaubter Zugang: Erfolg; Anfrage-Limits: 429 testen.
- [ ] Projektexport und -import mit Fotos, Skizzen und Werkstattprofil testen; außerdem iPad/iPhone-Mikrofon, Foto, Icon und Offline-/Service-Worker-Verhalten.
- [ ] Externe API-Ausgabenalarme/Budgets prüfen; Anfragelimits sind kein Euro-Kostenlimit.
- [ ] Tester erst nach erfolgreichem Staging-Test und verifizierter Datensicherung umstellen.
- [ ] Nach erfolgreichem Wechsel alten ungeschützten API-Zugang abschalten/absichern; Löschen alter ZIPs allein schützt nicht.

**Sicherheitsgrenzen:** Eine Browser-App bleibt einseh- und kopierbar. Zugangsschlüssel werden im aktuellen 0.9.20c-Entwurf nur im Arbeitsspeicher gehalten und nach Neuladen erneut abgefragt. Einzelinstanz-Zähler überstehen keinen Server-Neustart. Für dauerhafte Quoten später zentrale Datenbank/Redis einsetzen.
