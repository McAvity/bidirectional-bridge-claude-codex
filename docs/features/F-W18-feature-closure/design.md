# F-W18 — projekt zamknięcia bez akceptacji

Status: plan do review, 2026-10-20. Bez zlecenia implementacji.
Wejście: [brief](brief.md), SHA-256
`7bc1c446d47edd97803a4be935d111b2eb540ca93ac2777989367fac25004c5c`.
Sprawdzony kod: `6433d2b828f04a7ea74dbf4d7709958cd4d5cc5c`.
Nie znaleziono wcześniejszych tasków W18. Używamy istniejącego worktree tej zmiany;
Yumi CLI nie jest dostępne, więc taski zachowują format Markdown z work-items/W17-*.

## Zweryfikowany punkt wyjścia

- `shared/control-plane/src/feature-workflow.ts`: FeatureWorkflow przechowuje feature
  jako rekord JSON. `derive`/`refresh` chronią obecnie tylko accepted i waiting_user;
  wynik ostatniego taska może więc nadpisać nowy stan bez dodatkowej ochrony.
- `shared/control-plane/src/store/state-store.ts`: FeatureRecord nie ma rejected,
  cancelled ani rekordu decyzji zamknięcia. Historia rund i pytanie już istnieją.
- `shared/mcp-server-core/src/tools.ts`: synchroniczne mutacje przechodzą przez
  IdentityRuntime.runMutation; accept najpierw zajmuje slot, potem go zwalnia.
  Tego wzorca nie można bezpośrednio skopiować do ponowienia zamknięcia po starcie
  innego featura. `manager-registry.ts:releaseFeature` zwalnia tylko wskazany ID.
- `orchestrator.ts:prepareRecovery` blokuje accepted/waiting_user, ale nie zna nowych
  stanów. Istnieją też ogólne operacje tasków, a nie tylko feature_run.
- `shared/protocol/src/types.ts`: task ma już terminalny CANCELLED. Przejście jest
  dostępne z PENDING/CLAIMED/WORKING/BLOCKED, lecz nie z VERIFYING. DONE/FAILED
  pozostają terminalne. Nie trzeba dodawać taskowego REJECTED.
- `sqlite-store.ts`: schema 5; attach/readonly odrzucają nowszy schemat. Ścieżka
  initialize także musi być sprawdzona: samo podniesienie numeru nie dowodzi,
  że każdy starszy konsument odmówi bez zmiany bazy.
- `scripts/diagnostics/project.mjs` ma jawne listy stanów/pól. Nowe metadane decyzji
  wymagają świadomej projekcji, nie automatycznego kopiowania do eksportu.

## Najmniejszy proponowany interfejs

Jedno narzędzie `bridge_feature_close`:
`{feature_id, outcome: rejected|cancelled, reason, decision_ref, idempotency_key}`.
Powód i wskazanie źródła są wymaganymi, ograniczonymi tekstami; decision_ref jest
opisem/odnośnikiem, nie poleceniem odczytu pliku. Bridge rejestruje oświadczenie
uprawnionego managera, nie potwierdza sam autorstwa człowieka. Konkretne limity,
kształt odpowiedzi i stabilne kody odmów ustali W18-01.

FeatureRecord otrzymuje dwa terminalne stany oraz niezmienny rekord closure:
wynik, powód, źródło decyzji, czas serwera i przypisanie managera według istniejącej
polityki tożsamości. Klucz i hash żądania korzystają z trwałej idempotencji repo.
Nie tworzymy drugiego rejestru statusów. Zachowujemy pytanie i odpowiedź, nawet null;
stan terminalny oznacza, że pytanie nie jest już aktywną bramką.

### Transakcja i powtórzenia

1. Zweryfikować natywną tożsamość, worktree i własność featura.
2. Rozpoznać powtórzenie bez zajmowania slotu. Identyczne żądanie odtwarza wynik;
   sprzeczny klucz/payload lub inny wynik zamknięcia odmawia. Kontrakt określi też
   identyczną decyzję z nowym kluczem, bez nadpisania czasu i pierwotnej historii.
3. Dla otwartego featura sprawdzić wszystkie przypisane taski/próby oraz lease,
   a także task koordynujący. Brak active_task_id sam nie wystarcza. Nieukończona,
   niespójna lub nierozliczona próba odmawia; nie wygaszamy jej na potrzeby close.
4. W jednej transakcji zapisać closure, stan, idempotencję, zdarzenie i zakończenie
   koordynacji oraz zwolnić wyłącznie własny slot. Wyjątek cofa całość.
   Historyczny feature bez slotu może zostać zamknięty przy pustym slocie;
   konflikt z innym aktywnym featurem nie może go odebrać.
5. Po commit nie uruchamiać żadnego wykonawcy. Awaria odpowiedzi nie zmienia skutków.

Rekomendacja dla taska koordynującego: nieukończony task kończy się CANCELLED dla obu
wyników produktowych, ze zdarzeniem wskazującym odrzucenie lub rezygnację. Istniejące
terminalne wyniki pozostają nienaruszone. W18-01 ustali obsługę VERIFYING (preferowana
wąska ścieżka w operacji close, bez udawanych przejść przez WORKING), współdzielonego
parenta i jego lease. Nie wolno anulować koordynatora używanego przez inny feature.
To lokalna bramka kontraktu, nie powód do ponownej decyzji produktowej.

### Brak ponownego otwarcia

Wspólna definicja terminalności obejmuje accepted/rejected/cancelled. Użyją jej
odczyty, refresh/derive, create istniejącego ID, run, wait/answer, accept, recovery
oraz późne reconciliation. Odczyt/idempotentne odtworzenie nie zajmuje slotu.
Odpowiedź na historyczne pytanie nie modyfikuje zamkniętego rekordu.

W18-01 sporządzi macierz również dla bezpośredniego delegate, retry, resume,
set_state, submit_deliverable i operacji lease na taskach przypisanych do featura.
Nie wystarczy blokada w narzędziu feature_run. Rezerwacja wykonania musi ponownie
sprawdzić terminalność w tej samej transakcji co close, zanim może wystartować worker.
Odczyty dawnych rezultatów pozostają możliwe; ponowienie nie może wznowić wykonania.
Zakres nie obejmuje kontroli dowolnego zewnętrznego procesu piszącego do repo.

## Migracja, diagnostyka i instrukcje

Proponujemy schema 6, mimo że kolumny JSON nie wymagają przebudowy: starszy kod nie
rozumie nowej terminalności. Migracja zachowuje otwarte rekordy 0.4.3 i historię,
nie zamyka nic automatycznie. Następuje wyłącznie obsługiwaną, autoryzowaną ścieżką.
W18-01 ustali macierz initialize/attach/readonly i guardy instalatora/rollbacku.
Starszy runtime nie może zostać dopuszczony do zmigrowanej bazy; nie obiecujemy
bezstratnego downgrade po nowych zapisach. Kopia sprzed migracji jest odzyskiwaniem
historycznego stanu, nie sposobem zachowania nowych decyzji w starym schemacie.

Odczyt lokalny pokazuje closure. Eksport diagnostyczny zachowuje rozpoznawalny stan,
czas i bezpieczne metadane; reason/decision_ref mogą zawierać prywatny tekst, więc
podlegają istniejącej polityce redakcji/aliasowania. Brak surowych treści w domyślnych
logach. AC-03/09 sprawdzamy na syntetycznych danych, nie kopii prywatnej bazy.

Feature-decide zapisuje decyzję; koordynator feature-execute stosuje close i sprawdza
wynik. Dokumenty i SQLite nie tworzą jednej transakcji: zapis decyzji przed wywołaniem
oraz trwały klucz pozwalają dokończyć checkpoint po awarii. Nie oznaczać skutecznego
zamknięcia bridge'a przed jego potwierdzeniem. Standalone zapisuje wynik dokumentowo;
stary runtime dostaje informację o wymaganym upgrade, nigdy zastępcze accept.
Feature-review rozróżnia REWORK od końcowego odrzucenia. Wspólny przewodnik i diagram
pokazują oba zakończenia oraz odmowę przy aktywnej rundzie. Kopie pluginów generujemy
ze źródeł. Bez ręcznego edytowania cache, baz użytkownika i aktywnego runtime.

## Dostarczenie i własność

| Kolejność | Task | Wynik |
| --- | --- | --- |
| 1 | [W18-01](../../../work-items/W18-01.md) | Kontrakt i macierz przypadków; lokalne niezależne review |
| 2 | [W18-02](../../../work-items/W18-02.md) | Lifecycle, MCP, migracja, diagnostyka i regresje |
| 3 | [W18-03](../../../work-items/W18-03.md) | Workflow, dystrybucja i walidacja wspólnego wyniku |

Taski są źródłem zależności. W18-02 posiada współdzielone schematy, stan i migrację;
W18-03 posiada instrukcje/generator i testy integracji dokumentacji. Zalecana jedna
kolejka implementacji: równoległe edytowanie tych samych kontraktów nie daje korzyści.
Koordynator integruje, prowadzi lokalne niezależne review i poprawki w zatwierdzonym
zakresie. Po zleceniu całego featura nie ma zewnętrznego odbioru każdego taska.

W18-01 jest gotowy do zlecenia po review/decyzji planu. W18-02 czeka na jego kontrakt;
W18-03 na implementację. Nie ma obecnie otwartego pytania produktowego. Zmiana zakresu
na przerywanie workerów, reopening lub rollback kodu wymaga osobnej decyzji.

## Walidacja i punkt wznowienia

Testy deterministyczne: stany wejściowe, odrzucenie i anulowanie, foreign manager,
restart, utrata odpowiedzi, fault injection przed commit, stary replay po starcie B,
wyścigi rezerwacji run/recovery z close, późny wynik i wszystkie wejścia mutacji.
Prawdziwy launcher/SQLite z atrapą wykonawcy potwierdza A-close → B-run bez modeli;
nie jest to dowód zachowania modelu. Fixture 0.4.3 potwierdza migrację i odmowę starego
runtime/rollbacku. Migawki kodu, plików i historii potwierdzają brak ich usuwania.

Wymagane wspólne kontrole: npm ci --ignore-scripts, npm run build, npm test,
python3 -m unittest discover -s tests -v, python3 -m unittest discover -s tools/pilot/tests -v,
kontrola wygenerowanych pakietów, odsyłaczy i git diff --check. Zastane awarie raportować
z porównaniem bazy, nie ukrywać ani rozszerzać featura na ich naprawę.
Testy modeli, publikacja, upgrade realnego projektu i zamknięcie jego featura pozostają
oddzielne. Teraz przygotowano tylko plan; następnie feature-review (plan) i feature-decide.
