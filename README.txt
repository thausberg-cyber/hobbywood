HOBBYWOOD Web Pilot 0.1
=======================

Zweck
-----
Dieser Pilot bildet den geplanten HOBBYWOOD-1.0-Nutzerfluss als mobile Web-App/PWA ab.
Die Bildanalyse ist in Version 0.1 noch simuliert. Fotos werden nur im Browser angezeigt; es erfolgt kein Upload an einen KI-Dienst.

Enthalten
---------
- Kamera- und Fotoauswahl auf iPhone/Android
- mehrere Projektbilder
- simulierte Analyse und gezielte Detailfoto-Rückfrage
- Nutzerwissen als Freitext
- Projektverständnis und offene Punkte
- Originalnachbau / eigene Variante
- Maßangabe
- Projektakte mit Material, Werkzeug, Baufolge und Sicherheit
- lokale Projektspeicherung über localStorage
- PWA-Manifest und Offline-Cache

Auf dem iPhone testen
---------------------
Für Kamera und "Zum Home-Bildschirm" sollte die App über HTTPS bereitgestellt werden.
Die Dateien können auf jedem einfachen statischen Webhost veröffentlicht werden (z.B. GitHub Pages, Netlify, Cloudflare Pages oder eigener Webspace).
Dann die HTTPS-Adresse in Safari öffnen und über Teilen > Zum Home-Bildschirm hinzufügen.

Ohne Hosting
------------
index.html kann am Mac direkt im Browser geöffnet werden. Manche iPhone-Funktionen (PWA-Installation, Service Worker und Kamera) sind bei lokalen Dateien eingeschränkt.

Datenschutz im Pilot
--------------------
Die gewählten Fotos verlassen in 0.1 nicht das Gerät. Eine echte KI-Anbindung benötigt später eine gesonderte Backend-/Datenschutzentscheidung.
