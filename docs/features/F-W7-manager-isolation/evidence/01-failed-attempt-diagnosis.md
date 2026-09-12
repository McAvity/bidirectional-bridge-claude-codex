# Diagnoza nieudanej próby W7-ID-01

**Wniosek:** Claude rozpoczął pracę w prawidłowym worktree i wykonywał odczyty kodu. Nie utknął przed startem ani na pierwszym poleceniu. Bridge przerwał go po 900000 ms, zanim powstał kontrakt. Zachowany identyfikator wskazuje istniejący lokalny transkrypt tej samej sesji; dostępne recovery nie dopuszcza terminalnego FAILED.

## Zakres i dowody

Diagnoza na jawne zlecenie użytkownika, bez zmiany ról, nowej próby, mutacji bazy lub nadzorującego runtime. Kod repo: 3d9325f (produkt nadal aeb92c2). Odczyt przez bridge_get_task i bridge_read_events; nie wywoływano narzędzi mutujących, w tym lease/answer/recover. Raport i checkpoint zapisano na podstawie bezpośredniej zgody użytkownika. Pełne transkrypty, uchwyty sesji, argumenty procesu i sekrety nie są częścią raportu.

Feature F-W7-manager-isolation, task task_<historical-10>, próba 0, parent task_<historical-1>. Zdarzenia 9–21: delegacja → start → zapis uchwytu → BLOCKED po anulowaniu → FAILED/TIMEOUT → zwolnienie lease. Brak deliverable/artefaktów. Globalny ostatni event przed i po odczytach: 32. Feature nadal waiting_user z historycznym q-01; nie zapisano odpowiedzi do bazy, zgodnie z zakazem jej mutacji. Użytkownik nie zatwierdził zmiany ról.

| Dowód | Ustalenie (UTC, 2026-09-11) |
| --- | --- |
| Telemetria próby / event 13 | Runtime wystartował 20:53:47.248; Claude Code 2.1.269, raportowany model claude-opus-5; limit 900000 ms, max_turns=32, jeden attempt. |
| Event 15 | Uchwyt zapisany 20:53:47.911; ma zgodność z nazwą pliku i sessionId w lokalnych rekordach transkryptu. Wartości nie publikujemy. |
| Transkrypt, linie 26–27 | Pierwsze Bash i wynik 20:53:51.700–51.985 potwierdzają właściwy cwd i HEAD e5cc93a43c2c9c2d127725048a65faa2050b1696. |
| Transkrypt, 186 rekordów | 29 Bash + 11 Read, 40 odpowiadających wyników, zero is_error, zero wywołań bez wyniku. Polecenia służyły inspekcji; brak Write/Edit i brak nowych plików w Git. |
| Transkrypt, linie 180–181 | Ostatnie narzędzie: inspekcja ścieżek kontroli i wejść hashowania; wynik 21:06:58.540. Brak późniejszego zakończonego działania lub finalnego wyniku. |
| Telemetria / events 16–21 | Koniec 21:08:47.933–47.936, termination_kind=timeout, process_exit_code=143; komunikat adapter exceeded its 900000ms deadline. Tokeny, koszt i turn_count są null — nie estymowano. |

Transkrypt odnaleziono poprzez dokładny uchwyt próby w prywatnym katalogu Claude projects dla bieżącego worktree, bez wyboru „najnowszej sesji”. Plik: 1195334 bajty, 186 linii, SHA-256 `689c156597388a1cad10e12ec10fdf580f30fe609143abafbfd45d2d34a178d9`; mtime 21:06:58.604 UTC. Pozostaje poza repo. Znany PID wykonawcy nie istniał już podczas diagnozy. Sam ten fakt nie jest trwałą gwarancją braku procesu przy przyszłym recovery; trzeba sprawdzić ponownie.

## Stderr i granice wniosku

Nie znaleziono trwałego stderr próby: .bridge zawiera tylko SQLite/WAL/SHM; ~/.claude/debug jest puste; w ~/.codex/log znaleziono jedynie log logowania (treści nie odczytywano, nie dotyczy próby). Stderr znanego nadzorującego procesu jest podłączone do pipe; nie odczytywano aktywnej rury, aby nie przechwycić komunikacji. Nie twierdzimy, że stderr było puste lub że żaden zewnętrzny host nie zachował swojej kopii.

Kod runnera `claude/claude-side/src/adapters/claude-code-runner.ts:684` uruchamia proces z cwd zadania i stdout/stderr pipe; linie 743–745 trzymają maks. 64000 znaków stderr tylko w pamięci. Ścieżki cancel/deadline (linie 850–868) zwracają wynik bez stderr; dopiero ścieżka braku result frame po zwykłym zakończeniu (883–893) dołącza ten bufor do błędu. Porównanie bajtów launcher/source oraz runner/orchestrator/task-service dist potwierdziło zgodność analizowanych punktów z przypiętym runtime; nie budowano go ani nie edytowano.

Transkrypt dowodzi aktywności także po wielominutowych odstępach, ale nie rozstrzyga, czy przerwy oznaczały generowanie, oczekiwanie API lub inny stan runtime. Ostatnie około 109 sekund nie mają zapisanego wyniku narzędzia. Brak dowodów na blokadę sandboxa, uwierzytelnienia lub quota w tej próbie; is_error=false nie oznacza dowodu braku wszystkich problemów wewnętrznych. Nie ma podstaw do automatycznego zwiększenia timeoutu jako potwierdzonej naprawy.

## Czego brakuje do bezpiecznego wznowienia

1. Osobnej, przetestowanej naprawy przejścia timeout/recovery: `orchestrator.ts:321–380` po deadline anuluje wykonawcę i ustawia FAILED, a `task-service.ts:535–550` odrzuca FAILED jako nieodzyskiwalny. Zachowany uchwyt nie usuwa tej blokady. Feature blocked nie jest tym samym co task BLOCKED.
2. Jawnej ścieżki odzyskania istniejącego taska/featura z zachowaniem owner, lineage, workspace i dokładnego uchwytu; bez nowego taska/sesji, ręcznej zmiany DB lub cichego fallbacku. Test musi dowieść zgodności potwierdzonego uchwytu po resume i braku podwójnego wykonawcy.
3. Ponownego sprawdzenia zakończenia poprzedniego procesu, lease i dostępności prywatnego transkryptu przed wykonaniem; obecna diagnoza nie uruchamiała --resume i nie potwierdza jego sukcesu.
4. Jawnego rozliczenia waiting_user/q-01 po autoryzacji przyszłych mutacji. Zgoda na diagnozę nie jest zgodą na zmianę ról ani zapis odpowiedzi do bazy.
5. Do wyjaśnienia samych opóźnień: dostępnego logu stderr/debug/request timings tej próby lub odpowiednio ograniczonej rejestracji w przyszłym, osobno autoryzowanym teście. Obecne ślady nie podają przyczyny długich przerw.

Następny krok: osobne zadanie naprawy timeoutów/recovery przed kontynuacją wave7. Ten raport niczego nie naprawia i nie zleca nowej próby. Zachować istniejący FAILED task, feature i prywatne ślady. Weryfikacja raportu: zgodność z metadanymi/transkryptem i kodem oraz git diff --check; testów produktu nie powtarzano, bo kod się nie zmienił.
