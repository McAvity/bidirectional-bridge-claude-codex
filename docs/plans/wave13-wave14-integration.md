# Wave13/wave14 — wspólna integracja

Data: 2026-09-16. Autoryzacja: użytkownik zlecił integrację po odbiorach obu dostaw.
Branch: waves13-14-integration. Główna baza: f80c0c7.

## Źródła i zmiany

- Wave13 e5ec2707da92bb73a983cc9e4ba59e6c8c3d1911, odebrane, bridge accepted.
- Wave14 50458be6463f71e4ba683fe90155d00b7edd080b, odebrany zakres niezależny.
- Review koordynatora 0109643; zachowane wraz z historią źródeł.
- eba3381 scala wave13; dbc724b scala wave14 i łączy mechanizmy.
- 50e274e wprowadza pin integracji; końcowy pin to 187fd3b z poprawką FIFO.

Konflikty launchera/MCP rozstrzygnięte z zachowaniem autoryzacji każdej operacji,
loggera oraz przygotowania worktree dopiero przy uprawnionej mutacji.
Hook używa stabilnej tożsamości callbacka mimo kontekstu tworzonego dla każdego
wywołania. Metadane dystrybucji przechodzą osobną projekcję do doctor.json w ZIP-ie:
wersje i pin, digest instrukcji, klasy lokalizacji, skonfigurowany plugin oraz
osobne niewiadome obserwacje. Nie uruchamia się kodu diagnozowanego projektu.
Odczyty nowych plików metadanych są ograniczone i odmawiają symlinków.
Rozpoznanie dispatchera używa rzeczywistego entry.mjs, a nie nieistniejącego dispatch.mjs.
Generator dołącza zależności diagnostyki do CLI pluginu.

## Walidacja — w toku

Instalacja npm ci --ignore-scripts i build PASS. Python:46, pilot-tooling:140 PASS.
Pakiety zgodne ze źródłami; kontrola144 dokumentów i diff PASS.
Niezależne review integracji: PASS po poprawce INT-R1 w 187fd3b.
Potwierdzona blokada FIFO przy odczycie metadanych usunięta przez O_NONBLOCK;
niezależna reprodukcja i 3 testy projekcji/doctora PASS.
Pierwszy pełny przebieg JS: 532 PASS / 4 FAIL. Jeden błąd dotyczył asercji
liczącej techniczne sidecary SQLite; trzy testów rollbacku odwołujących się do
HEAD zmienionego podczas korekty. Test łączny po poprawieniu asercji PASS.
Porównanie wersji testów przypięto do runtimeCommit; finalny pełny przebieg w toku.
Nowy test łączny używa rzeczywiście zainstalowanego runtime, nowego worktree,
autoryzowanej operacji MCP, normalnego zamknięcia i eksportu z metadanymi pluginu.
To test bez modeli, nie nowy pilot Astry i Claude'a.

## Granice i następny krok

Nie przełączono aktywnego runtime, nie wdrożono do projektów użytkownika i nie
zmieniono prywatnych baz ani konfiguracji. Nie wykonano push ani publikacji marketplace.
Po testach/review: zapisać wynik, scalić do feature-workflow bez przełączania runtime.
Odbiór niezależnej części wave14 jest zachowany; nie zastępuje odbioru wspólnego wyniku.
Nie wywoływać feature_accept z innego managera w bazie oryginalnego wave14.
Wave15 nadal DRAFT; nie implementowano jego zakresu.
