# Wave10 — integracja izolacji z recovery i pilot dwóch par

Status: DO WYKONANIA. Plan nie uruchamia modeli ani wdrożenia.

## Cel i wejścia

Połączyć odebrany F-W7-manager-isolation z opublikowanym timeout/recovery wave9,
a następnie sprawdzić dwie rzeczywiste pary Astra–Claude w osobnych worktree.
Źródło izolacji: wave7 @ 66e524f0e334b159ccd5fb3cd3606bf58e858a68, accepted
według raportu managera. Źródło integracyjne: feature-workflow, obecnie 4adb51d.
Przypiąć rzeczywiste SHA przy starcie; nie cofać nowszych zmian.

## Do wykonania

1. Osobny branch/worktree integracji. Sprawdzić graf i zakresy zmian wave7/wave9.
   Zachować odebrane zachowanie, kontekst i historię; nie otwierać ponownie całego
   review już przyjętego featura. Nie mutować jego bazy ani przypiętego runtime.
2. Przygotować publiczną integrację: sprawdzić pliki i metadane historii przed importem,
   zachować oryginalne branche, przy oczyszczaniu zapisać mapowanie commitów. Prywatne
   dowody zostają lokalnie; wystarcza zanonimizowane podsumowanie i syntetyczne testy.
3. Rozwiązać rzeczywiste konflikty, szczególnie w orchestrator, control-plane, narzędziach
   MCP, schemacie i instrukcjach. Guard tożsamości musi obejmować nowe recovery
   FAILED/TIMEOUT, także retry/replay, bez świeżej sesji i bez podwójnej próby.
   Sprawdzić niezgodność hosta, legacy adoption, waiting_user i jawne przejęcie managera.
4. Wykonać build oraz pełne testy wspólnego wyniku; dopisać tylko regresje wynikające
   z integracji. Skupić review na konfliktach i współdziałaniu, nie powtarzać audytu
   niezmienionych części. Wynik: jedna lista istotnych ustaleń i ich zamknięć.
5. Przygotować przypięty build pilota, dwa niezależne worktree i krótką instrukcję
   operatora. Ustalić przed startem zakres, koszt/budżety, stop conditions i kryteria.
   Pilot z modelami uruchomić po zatwierdzeniu jego konkretnego zakresu i budżetu.
6. Pilot: równoległe zadania dwóch par, brak mieszania sesji, stanów i paczek przy
   identycznych nazwach featura/rundy; waiting_user i resume jednej Astry podczas
   pracy drugiej. Próba obcego managera odrzucona bez mutacji. Odczyty nie przejmują
   własności. Syntetyczne przypadki awarii nie stają się przez to wynikami real-model.
   Nie wywoływać sztucznie 75-minutowego oczekiwania, jeśli nie jest potrzebne do
   rozstrzygnięcia konkretnego ryzyka; długie limity pozostają osobnym ograniczeniem.
7. Zapisać wynik i ograniczenia, rozliczyć ewentualne poprawki, przygotować publikację
   po review integracji. Nie zastępować odebranej implementacji deklaracją pełnego
   zaliczenia wcześniejszego kontrolowanego pilota wave6.

## Kryteria zakończenia

Integracja opublikowana po akceptacji, CI przechodzi; kontrola tożsamości i timeout
recovery działają razem w testach. Pilot dwóch par wykonany i rozliczony z dowodami,
bez fałszywego PASS dla nieuruchomionych ścieżek. Instrukcja start/resume i znane
ograniczenia umożliwiają powtórzenie. Jeśli pilot ujawnia blokadę, status częściowy,
nie ukryte zamknięcie całego wave10.

Poza zakresem: instalator, pełna diagnostyka, retencja, supervisor oraz analiza
kosztu/pętli review (wave11). Nie przebudowywać runtime obsługującego aktywną pracę.
Postęp: wave10-progress.md; końcowy raport: wave10-report.md.
