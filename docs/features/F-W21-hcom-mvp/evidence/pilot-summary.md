# Pilot F-W21 — rzeczywisty cykl przez hcom

2026-11-10. Wynik: **pełna pętla działa w jednej natywnej sesji**, bez kopiowania
odpowiedzi przez użytkownika. Jedno podejście, dwa zlecenia, oba przez hcom.
Koordynator jawnie odebrał poprawiony wynik po sprawdzeniu raportu, diffu i testów.
To odbiór zadania syntetycznego; odbiór featura przez użytkownika pozostaje Gate 2.

## Metoda i zakres dowodu

Dostawa procedury c0cd9cf, review W21-01 0ceac0d; zgoda03. Osobne repo syntetyczne,
HCOM_DIR poza repo wykonawcy, jeden Claude Code uruchomiony przez hcom headless,
bez zadaniowego promptu startowego. Koordynator Codex wysyłał komendy jako zewnętrzny
nadawca. Przed pierwszym send, przed korektą i po dostawie porównano natywne ID
oraz katalog. Brak wymiany sesji, delegowania i automatycznego resend.
Worker otrzymał wyłącznie publiczny kontrakt, worker.md i repo syntetyczne.

Wersje: hcom **0.7.31**, Claude Code **2.1.321**; istniejące logowanie claude.ai,
firstParty, subskrypcja Max. Pole model w hcom: `claude-opus-5-5` (obserwacja tej
sesji, nie gwarancja ogólnej dostępności). Nie instalowano hcom ani nie zmieniano
modelu, konfiguracji osobistej czy kluczy. Koszt pieniężny nieudostępniony przez
klienta (`null`), nie deklarujemy zera; próba zużywa limity istniejącego konta.

## Przebieg i odbiór

| Etap | Zdarzenia hcom UTC | Niezależny wynik koordynatora |
| --- | --- | --- |
| Runda 1 | request6 12:17:19.877 → ready23 12:20:47.810 | 6 testów PASS; zapisany diff identyczny z rzeczywistym Git diff |
| Review | przed request26 | Implementacja poprawna; konkretna uwaga o teście braku mutacji wejścia i docstringu |
| Runda 2 | request26 12:21:45.419 → ready46 12:25:51.113 | 7 testów PASS; nowy test i docstring, ta sama sesja, diff zgodny |
| Odbiór | 12:28:37 UTC | Raport2 kompletny; zachowane raport1/diff1; przyjęto wynik zadania |
| Zakończenie | po odbiorze | `/exit` wyłącznie własnego workera; hcom potwierdził stopped, exit:prompt_input_exit |

Runda 1: trim, usunięcie pustych wartości, deduplikacja z zachowaniem kolejności,
rozróżnianie wielkości liter. Runda 2: rzeczywista poprawa testu/dokumentacji,
**nie naprawa wymyślonego błędu**. Test potwierdza niezmienione wejście oraz nową
listę wynikową, także przy już znormalizowanym wejściu. Logika i 6 testów zachowane.
Powiadomienia RESULT_READY to broadcast z recipient_count=0: odbiór następował
przez odczyt historii hcom, nie automatyczne dostarczenie do interaktywnego inboxu
Codexa. Worker w końcowej wypowiedzi sugerował dostarczenie do koordynatora;
operator opiera wynik na zdarzeniach i raportach, nie na tej deklaracji.

[Obserwacje JSON](observations.json) są zanonimizowanym zestawieniem, nie surowym
logiem ani dowodem kryptograficznym. Native ID, prywatne ścieżki, transkrypty i baza
hcom pozostają poza Git. [Runda1](round1/contract.json) i [runda2](round2/contract.json)
zawierają kopie kontraktów z workspace zastąpionym placeholderem. Raporty zachowują
oryginalne ścieżki `.hcom-mvp/` z repo pilota; ich diff jest publikowany jako
`delivery.patch` w odpowiednim katalogu rundy. Kod/testy/raporty są syntetyczne.
Powtórzenie testów offline: wejdź do evidence/round1 lub evidence/round2 i uruchom
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`.
To weryfikuje artefakt, nie odtwarza komunikacji z modelem.

## Tarcie i budżet

- Start wymagał jednej zgody na zaufanie dokładnie wskazanemu repo. Launcher
  wcześniej zwrócił blokadę readiness; po obsłużeniu trust ta sama sesja była gotowa.
- **11 pojedynczych zgód klienta**: 5 w rundzie1, 6 w rundzie2, na odczyty,
  zmiany/testy, raport i wysłanie powiadomienia. Operator każdorazowo sprawdzał
  konkretną operację. Nie przełączano permission-mode default, nie używano bypass.
  Zgody obsłużył agent-operator; użytkownik nie przenosił treści ani nie naprawiał zleceń.
- Krótkie oczekiwania 45s wygasały przy czekaniu klienta na zgodę. Po timeout
  odczytywano historię i stan/terminal; nie przyjmowano idle jako dostawy.
- Od send do ready: około 3m28s i 4m06s; od pierwszego send do gotowej poprawki
  8m31s, do jawnego odbioru 11m17s. Obejmuje pracę modelu i obsługę operatora.
  Czas aktywnej obsługi nie był mierzony osobnym stoperem, więc nie da się go
  uczciwie oddzielić od oczekiwania; liczba interwencji jest dokładniejszą metryką.
- 1/2 podejścia, 2/4 zadaniowe prompty; każda runda poniżej 10 minut, część
  modelowa/odbiór poniżej 45 minut. Zakończono po pierwszej udanej pętli.
- Brak brakujących danych przy odbiorze, napraw transportu, ręcznego przenoszenia
  odpowiedzi, nowego wykonawcy czy zmiany dotychczasowego Bridge'a.

## Kontrole procedury i kryteria

[Checklista](../../../hcom-mvp/checks.md) ma siedem jawnych przypadków.
Poniższe decyzje dla scenariuszy błędnych to desk-check, nie test automatycznego
walidatora ani dodatkowe próby modeli.

| Wejście | Zastosowana decyzja / rodzaj dowodu |
| --- | --- |
| Zgodny raport+diff+test | Odbiór po review; realne rundy1/2 |
| Idle/ready bez raportu | Brak odbioru, diagnoza; desk-check |
| Obcy task_id | Nie przyjmować jako bieżącego zadania; desk-check |
| Stara round | Nie przyjmować jako rundy2; historia realnie zawierała ready1 |
| failed/not_run | Nie zaliczać sprawdzenia; desk-check na przykładzie not_run i failing |
| Timeout | Historia+diagnoza, bez nowej sesji; realne krótkie timeouty |
| Zmieniony native session_id | Wstrzymać korektę; desk-check; realne ID pozostało równe |

AC-01 i AC-03: realne zlecenia, dostawy, korekta i odbiór w tej samej sesji.
AC-02: kontrakty/raporty, rzeczywiste diffy i niezależnie powtórzone testy.
AC-04: powyższe decyzje i rzeczywista obsługa timeoutów; część negatywna ręczna.
AC-05: wersje, interwencje, czasy i jawne ograniczenia pomiaru w tym raporcie.
AC-06: wyłącznie procedura i dowody; brak zmian runtime, integracji i projektów.
Ocena koordynatora: kryteria spełnione dla zatwierdzonego minimalnego zakresu;
niezależny werdykt znajduje się w [review02](../reviews/02-execution.md).

## Rekomendacja

Używać opt-in do małych lokalnych zadań z jednym wykonawcą i jawnym odbiorem.
Minimalny kontrakt wystarczył w tej próbie; nie ma podstaw, by teraz budować pełny
adapter Bridge'a. Pierwszy kandydat do dalszego badania to ergonomia konkretnych
zgód klienta w izolowanym repo; nie wyłączanie zabezpieczeń. Kolejna próba powinna
mierzyć osobno czas obsługi operatora. Brak benchmarku z Bridge'em, statystyki
niezawodności, crash recovery, resume po zamknięciu i obsługi wielu workerów.
Nie rekomendujemy na tej podstawie powszechnej migracji istniejących projektów.
