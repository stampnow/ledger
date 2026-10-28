# LEDGER – Trading-Journal mit Statistik-Analyse

Web-App zum Erfassen und statistischen Auswerten von Journaldaten. Einträge werden mit frei definierbaren, typisierten Kriterien erfasst, die App berechnet daraus Kennzahlen und zeigt, welche Kriterien mit guten oder schlechten Ergebnissen zusammenhängen.

**Tech-Stack:** React 18 · Vite · Tailwind CSS · Recharts · lucide-react

## Funktionen

- **Mehrere Journals** mit jeweils eigenen Kriterien
- **Typisierte Kriterien:** Dropdown (kategorisch), numerisch oder Notiz. Freitext-Notizen sind bewusst aus allen Statistiken ausgeschlossen, damit keine unauswertbaren Daten entstehen.
- **Kennzahlen:** Erwartungswert pro Eintrag, Trefferquote mit 95-%-Konfidenzintervall (Wilson), Profit-Faktor, maximaler Drawdown
- **Diagramme:** kumulierte Ergebniskurve und Verteilung der Ergebnisse
- **Analyse nach Kriterien:** rankt Segmente (einzeln und als 2er-Kombination) nach Erwartungswert, gewichtet nach Stichprobengröße. Zu jedem Segment werden n und Konfidenzintervall angezeigt, kleine Stichproben werden markiert.
- **Demo-Daten** zum direkten Ausprobieren
- **Lokale Speicherung** im Browser (localStorage), kein Server nötig

## Statistischer Ansatz

Eine nackte Trefferquote ist bei kleinen Stichproben irreführend: 70 % bei n = 6 und 70 % bei n = 80 sind nicht dasselbe. Deshalb zeigt die App immer die Stichprobengröße und ein Wilson-Konfidenzintervall. Die Sortierung nutzt den Erwartungswert, gedämpft mit `n / (n + 12)`, damit kleine Segmente nicht ganz oben landen. Werden viele Kombinationen gleichzeitig getestet, warnt die App vor zufälligen Treffern (Multiple-Comparisons-Problem).

## Lokal starten

```bash
npm install
npm run dev
```

Build für die Veröffentlichung:

```bash
npm run build
```

## Autor

Joel Noah Janik
