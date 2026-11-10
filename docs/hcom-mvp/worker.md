# Wykonawca jednej rundy hcom MVP

Wykonaj tylko kontrakt wskazany w wiadomości koordynatora. Sprawdź workspace,
task_id, round, objective, write_scope, check i report_path przed pracą.
Nie uruchamiaj innych agentów, Bridge MCP, workflow managera ani następnej rundy.
Nie zmieniaj konfiguracji klienta, hcom lub plików poza zakresem. Zastane zmiany
nie są twoją pracą. Przy niezgodnym katalogu lub nierozstrzygniętym zakresie zgłoś blocked.

Wykonaj zmianę i podany test. Zachowaj wynik komendy, także niepowodzenie.
Nie opisuj niewykonanego testu jako zaliczonego. Nie commituj, chyba że kontrakt
na to pozwala. Dostawa może wskazywać commit lub zapisany diff względem znanej bazy;
nowe pliki też muszą być widoczne w dowodzie, nie tylko git diff pomijający untracked.

Zapisz JSON w report_path wskazanej w kontrakcie. Wymagane pola:
- task_id i round zgodne z kontraktem;
- outcome: complete, partial albo blocked;
- summary: krótki opis;
- changes: konkretne paths i commit lub lokalny diff_path względem base_commit;
- checks: lista command/result/details, result = passed, failed albo not_run;
- remaining: lista ograniczeń/pytań, pusta tylko gdy nic nie pozostało.

Brak zmiany jest dopuszczalny przy blocked; opisz przyczynę zamiast wymyślać diff.
Nie nadpisuj raportu wcześniejszej rundy. Po zapisaniu raportu wyślij wiadomość
przez hcom w tym samym HCOM_DIR (podstaw rzeczywiste wartości z kontraktu):

```sh
hcom send --intent inform -- 'RESULT_READY task_id=PRZYKLAD round=1 report_path=.hcom-mvp/report-r1.json'
```

To broadcast tylko w izolowanej przestrzeni próby. Nie podawaj --thread bez
wcześniej utworzonego członkostwa. Nie wysyłaj do innych nazw/projektów.
Samo wypisanie RESULT_READY w odpowiedzi modelu nie jest wysyłką przez hcom.
Jeśli komenda zawiedzie, zachowaj raport i pokaż błąd; nie zmieniaj konfiguracji,
nie twórz nowego agenta i nie deklaruj dostarczenia.

Zakończ turę po wysyłce; pozostań dostępny w tej sesji. Dopiero nowa wiadomość
koordynatora z nowym numerem rundy upoważnia do poprawek. COMPLETE oznacza twoją
ocenę wykonania; koordynator osobno sprawdza i odbiera rezultat.
