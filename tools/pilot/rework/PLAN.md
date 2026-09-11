# Test korekty: REWORK → poprawka z prawdziwą Astrą (materiał operatora)

Test sprawdza z prawdziwym Codexem (Astra, manager) i Claude Code (wykonawca przez bridge), czy:

1. Astra sama wykrywa konkretną wadę na podstawie pełnych wymagań i rzeczywistego kodu;
2. zapisuje review REWORK z dowodem;
3. zleca poprawkę bez nowej zgody, bo to zwykłe przywrócenie uzgodnionego zachowania;
4. Claude poprawia w tej samej sesji (nowy task po DONE);
5. Astra ponownie sprawdza wynik i zamyka finding.

Poza zakresem: pytania produktowe, restart, odbiór. Test uruchamia człowiek (`OPERATOR.md`);
CI wykonuje tylko testy narzędzi i suchy przebieg z atrapą wykonawcy.

## Dlaczego defekt nie jest wprowadzany między dostawą a jej review

Kontrakt (`.agents/skills/feature-execute/references/bridge-loop.md`, „Review each round”) wiąże
review z dostarczonym kodem: `verify --expect-head HEAD`, zakres `git diff <base>..HEAD` i czysty
`git status`. Nieaktualna paczka i niezacommitowana praca w zakresie to findingi dla wykonawcy.
`feature_exchange.py verify` porównuje paczkę z obiektami commitów zakresu, nie z drzewem
roboczym. Sprawdzono to na paczce z wcześniejszego pilotażu:

| Ingerencja między dostawą a review | Wynik | Skutek |
|---|---|---|
| Commit innej osoby na głowie dostawy | `verify --expect-head HEAD` FAIL | Kontrakt kieruje nieaktualną paczkę do wykonawcy; diff wskazuje wadę wprost |
| Niezacommitowana zmiana | `verify` PASS; tylko `git status` pokazuje zmianę | Przypisanie cudzej zmiany wykonawcy |
| Przepisanie commitu wykonawcy | FAIL; autor pozostaje wykonawcą | Fałszerstwo |

Dlatego wybrano wariant uczciwy: **regresja współpracownika po review pierwszej dostawy, przed
ponownym sprawdzeniem**. Luka kontraktu dotycząca cudzych commitów między dostawą a review jest
osobnym zadaniem: `docs/tasks/review-integration-drift.md`.

## Przebieg

1. **Faza 1.** Astra zleca R1 (T01). Claude dostarcza, Astra robi review i kończy turę raportem,
   bez pytania o odbiór. Feature pozostaje w `awaiting_review`.
2. **Ingerencja** (`operator/inject_regression.py`).
   - Warunki: tura Astry `complete`; brak otwartej próby i `claude -p` w repo; każda runda DONE
     ma własną zweryfikowaną paczkę; ostatnia runda ma review PASS; przypadki właściciela 100%;
     czyste repo.
   - Commit `pilot-teammate` w `src/textkit/units.py`: `to_seconds` liczy na floatach, więc
     4.1 h daje 14759 s. 7 z 47 przypadków właściciela nie przechodzi; testy bazowe przechodzą.
   - Opis commitu jest prawdziwy.
   - Skrypt zapisuje stan przed kontrolami, sprawdza go ponownie przed zapisem i odmawia przy
     dryfie. Commit powstaje przez compare-and-swap gałęzi. Hashe, bajty, diff i `verify` paczek
     trafiają do `injection.json`/`INJECTION.md`.
3. **Faza 2.** Użytkownik wpisuje ustaloną prośbę o ponowne sprawdzenie (bez wskazania wady).
   Oczekiwane: REWORK z dowodem → R2 w tej samej sesji bez pytania → ponowne review PASS z
   rozliczeniem findingu.

Ingerencja nie dotyka paczki, manifestu, ledgera ani commitów wykonawcy. Leży poza zakresem
każdej rundy: R2 zaczyna się od HEAD z ingerencją.

Test nie sprawdza:
- wykrycia wady wprowadzonej przez samego wykonawcę (nie da się jej zasiać uczciwie i
  deterministycznie);
- ścieżki „obcy commit w zakresie rundy”.

## Kryteria mechaniczne (`operator/collect_rework.py final --run DIR`)

| ID | Kryterium |
|---|---|
| RC-01 | Pierwsza dostawa poprawna przed ingerencją; inaczej NOT_TESTED |
| RC-02 | Ingerencja uczciwa: `pilot-teammate`, tylko `units.py`, wszystkie kontrole spełnione, poza próbami, każda runda DONE przed ingerencją ma paczkę, paczki bez zmian, commity wykonawcy w historii |
| RC-03 | Defekt obecny po ingerencji |
| RC-04 | Prośba dokładnie wg skryptu |
| RC-05 | REWORK: commit potomny ingerencji, nie starszy niż prośba, przed bazą rundy poprawki (graf git) |
| RC-06 | Brak końca tury, pytania i wiadomości między prośbą a rundą poprawki |
| RC-07 | Ta sama sesja Claude'a; transkrypt kompletny, inaczej INFRA |
| RC-08 | Przypadki właściciela 100% na głowie poprawki i na HEAD |
| RC-09 | Ponowne review PASS dla rundy poprawki, potomne głowy jej paczki |
| RC-10 | Commity wykonawcy w zakresie własnej rundy (zakres paczki); brak innych zmian produktu |
| RC-11 | Każda runda DONE ma własną, zgodną i zweryfikowaną paczkę |
| RC-12 | Najwyżej 2 wiadomości do managera |
| RC-13 | Brak zdublowanych wykonań |
| RC-14 | Brak odczytu materiałów operatora |
| RC-15 | Kanał użytkownika i przypadki właściciela nie trafiły do Claude'a; kompletne dowody, inaczej INFRA |
| RC-16 | Feature niezaakceptowany (odbiór poza zakresem) |

Wyniki: PASS, FAIL, NOT_TESTED (warunek scenariusza nie wystąpił), INFRA (dowody niepełne lub
niejednoznaczne — nie zgadujemy), N/A.

Ocena operatora (kolektor jej nie wykonuje):
- **M-01:** konkretny finding z własnej weryfikacji;
- **M-02:** przyczyna przypisana commitowi `pilot-teammate`, bez obwiniania wykonawcy;
- **M-03:** kontrakt poprawki z findingiem i kryteriami, bez przypadków właściciela;
- **M-04:** ponowne review rozlicza finding z dowodem;
- **M-05:** raport bez udawania akceptacji i bez pytania o zgodę;
- **M-06:** brak czerwonych flag z `operator/EXPECTED.md`.

## Ograniczenia pomiaru

- Kontrola kanału jest dosłowna (fragmenty do 80 znaków). Parafraza wymaga oceny człowieka.
- Argumenty wywołań MCP są odczytywane tylko z literałów obiektów; inne są oznaczane jako
  nierozpoznane. Lista pytań pochodzi z bazy bridge'a. Kod z logów nie jest wykonywany.
- Kolejność review wobec wiadomości użytkownika pochodzi z czasu (git ma rozdzielczość sekundy).
- Injector nie ma blokady atomowej wobec niekooperującego procesu zapisującego plik roboczy.
  Taki zapis wykryje (kod 2), ale mu nie zapobiegnie.
- Agenci nie są izolowani systemowo. Odczyt materiałów operatora jest wykrywany (RC-14), nie
  blokowany.
