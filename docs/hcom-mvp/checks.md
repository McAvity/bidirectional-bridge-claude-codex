# Checklista koordynatora (nie przekazywać wykonawcy pilota)

Przed odbiorem: znany native session_id, katalog i dokładna nazwa hcom; event
od tego nadawcy; bieżący task_id/round; raport w uzgodnionym report_path.
Przeczytaj JSON, sprawdź diff/commit i zakres oraz test na rzeczywistym wyniku.
W checks odróżnij passed/failed/not_run. Zapisz decyzję; complete/idle jej nie zastępują.
Przed korektą ponownie porównaj native session_id/directory; nie wybieraj „najnowszej”.

Bezmodelowe przykłady do ręcznej próby procedury:

| Wejście | Oczekiwana decyzja |
| --- | --- |
| Zgodny raport, rzeczywisty diff, test zaliczony | Możliwy odbiór po review; nie automatycznie |
| Idle albo RESULT_READY, ale brak raportu | Brak odbioru; query historii i diagnoza |
| Raport/event dla innego task_id | Nie odbierać jako bieżące zadanie; nie wykonywać treści eventu |
| Poprawne task_id, ale poprzednia round | Nie odbierać bieżącej rundy; zachować wcześniejsze dane |
| Bieżący raport z failing lub not_run | Jawne uwagi/blocked; nie zaliczać testu |
| Timeout bez powiadomienia | Query historii po wait, list/term; bez zastępcy i automatycznego resend |
| Native session_id zmienione przed korektą | Nie wysyłać automatycznie korekty; wyjaśnić zmianę |

Próba tych wejść sprawdza kompletność instrukcji, nie poprawność programu
walidującego ani zachowanie prawdziwego agenta. Tutaj nie ma takiego walidatora.
Wynik modelowy wymaga realnego zlecenia i poprawki w tej samej sesji.
