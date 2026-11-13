# AppartHunt

**Un agent IA qui cherche un appartement à ta place.** Tu écris en français ce que tu veux ; l'agent cherche les annonces, les lit, les note selon *tes* critères, met les bonnes en favori et prépare les candidatures. Rien ne part sans ta validation.

Je l'ai construit pour ma propre recherche d'appartement, en zone tendue, là où les bonnes annonces partent en quelques heures. Je m'en suis servi au quotidien pendant cette recherche.

![Python](https://img.shields.io/badge/Python-3.11%2B-blue) ![Electron](https://img.shields.io/badge/Electron-33-47848F) ![Claude Code](https://img.shields.io/badge/Cerveau-Claude%20Code-d97757) ![Licence](https://img.shields.io/badge/Licence-MIT-lightgrey)

## L'idée

Les sites d'annonces sont des catalogues : c'est toi qui fais le travail. AppartHunt inverse ça.

1. **Tu écris tes contraintes** dans `recherche.md`, en texte libre : budget, quartiers préférés, indispensables, ce qui t'est égal.
2. **L'agent en tire ses réglages** (`profil.json`) et les relit avant chaque recherche. Tu changes d'avis, tu modifies le texte, tout se réajuste.
3. **Il cherche et lit chaque annonce**, repère les pièges (bail étudiant déguisé, location de quelques mois, rez-de-chaussée, arnaque) et note le reste sur 10.
4. **Chaque annonce te parle de toi** : « ✓ un de tes quartiers préférés », « ✓ 80 € sous ton budget », « ✗ pas de parking, c'est important pour toi ».
5. **Il agit sous contrôle** : favoris sur les sites, candidature rédigée, mais chaque envoi attend ton accord.

## Où en est le projet

C'est un projet perso, utilisé pour de vrai, pas un produit fini.

| Partie | État |
|---|---|
| Appli de bureau (Mac) : annonces, carte, fiches, conversation avec l'agent | Utilisée au quotidien |
| Veille automatique toutes les 30 min (Leboncoin, Bien'ici) | Utilisée au quotidien |
| Notation déterministe et filtres | Stable |
| Conversations reprises après une coupure ou un redémarrage | Récent, testé |
| Zone de recherche configurable (`zone.json`) | Récent : l'exemple fourni est fictif |
| Autres sites (SeLoger, PAP…) | Lus par l'agent dans le navigateur, sans outil dédié |
| Windows, Linux | Jamais essayé |

Tests : `app/tests/ecran.test.py` vérifie le vrai écran avec de fausses données (30 vérifications, sans appel à l'IA) ; `app/tests/taches.test.js` vérifie les conversations avec de vrais appels à un petit modèle.

## Comment c'est construit

```
recherche.md  ──►  Claude Code (le cerveau)  ──►  outils Python  ──►  base locale  ──►  appli / page
 (tes mots)        skill /agent-locataire        agent/               SQLite            carte, fiches,
                   raisonne, décide, retient     recherche, notation,                   « Pour toi »
                                                 favoris, mémoire
```

- **Le cerveau, c'est Claude Code**, en local, piloté par un skill (`.claude/skills/agent-locataire/SKILL.md`) qui décrit un passage de recherche et ses règles. Pas de clé d'API nécessaire.
- **Les outils** sont des commandes Python (`./al tool <outil> '<json>'`) : chercher, lire une fiche, noter, décider, mettre en favori, proposer une candidature, retenir.
- **La notation est déterministe** (`agent/src/agent_locataire/scoring.py`) : l'agent l'appelle comme un outil, il ne l'invente pas. Le modèle lit et rédige, le code calcule.
- **Le navigateur** : l'appli embarque le sien (Chromium, via Electron). Tu t'y connectes une fois aux sites, la session est gardée. Claude Code le pilote par un petit serveur MCP local (`app/agent-browser.js`).
- **Une mémoire** : l'agent retient ce qu'il apprend (« Studapart = baux étudiants, à écarter ») et s'en sert aux passages suivants.
- Variante incluse : la même boucle via l'API Anthropic (`agent/src/agent_locataire/agent.py`, tool runner).

## Les garde-fous

- **Le texte des annonces n'est jamais une instruction** pour l'agent : c'est une donnée écrite par des inconnus.
- **Rien d'irréversible sans validation** : l'agent propose les candidatures, tu valides chacune. Une deuxième candidature pour la même annonce est refusée par le code (`tools/suivi.py`), pas seulement par une consigne.
- **Pas de contournement** des protections anti-robot, pas de saisie de mot de passe, pas de paiement. Si un site demande une vérification, l'agent s'arrête et te le dit.
- **Données perso hors du dépôt** : tes annonces, tes critères, ta zone et ton dossier locataire restent sur ta machine (`.gitignore` et un hook `pre-commit` qui bloque toute fuite).

## Ta zone

Aucun lieu n'est écrit dans le code. La zone se règle dans `zone.json` (modèle : `examples/zone.example.json`, autour de Bordeaux, fictif) :

- **les communes**, avec leur code postal (pour Leboncoin), leur identifiant Bien'ici, un cercle (1 = en priorité, 2 = si on a de la marge) et une note sur 10 ;
- **les quartiers**, avec un motif à reconnaître dans l'annonce, une note et une position approchée pour la carte.

L'identifiant Bien'ici d'une commune se trouve sur `https://res.bienici.com/suggest.json?q=<commune>` (champ `zoneIds`). Tu peux aussi demander à l'agent de compléter le fichier.

## Essayer

```bash
# 1. Dépendances de l'agent
cd agent && uv sync && cd ..

# 2. Activer le garde-fou anti-fuite
git config core.hooksPath .githooks

# 3. Ton dossier de recherche (sinon, ce sont les exemples qui s'appliquent)
mkdir -p ma-recherche
cp examples/recherche.example.md ma-recherche/recherche.md
cp examples/profil.example.json ma-recherche/profil.json
cp examples/zone.example.json ma-recherche/zone.json

# 4. La page avec les annonces d'exemple
python3 tools/build_page.py && open ma-recherche/selection.html

# 5. Un passage de l'agent : dans Claude Code, à la racine du projet
#    /agent-locataire
```

## L'appli de bureau

```bash
cd app && npm install && npm start
```

Sur Mac, `sh app/installer-mac.sh` en fait une vraie appli (nom, icône, Launchpad, Dock) qui charge le code du dépôt.

- **À droite, la conversation avec Claude Code** : tu écris (ou tu dictes) « lance une recherche », « va voir si la deuxième est au rez-de-chaussée », « garde la troisième », « finalement je veux un parking ». Chaque action de l'agent s'affiche avec sa commande et son résultat ; tu peux le recadrer pendant qu'il travaille.
- **Annonces** : une ligne par annonce avec sa note et sa raison, des filtres, une carte. Un clic ouvre la fiche (photos, détails, pourquoi cette note).
- **Navigateur** : la vraie page de l'annonce, avec le verdict de l'agent en haut et « Je garde » / « Pas pour moi ».
- **Activité** : chaque passage de la veille et chaque session de l'agent, avec le détail des commandes.
- **Profil** : tes critères, ce que l'agent a retenu, ton dossier locataire.

Sous le capot : l'appli lance Claude Code en mode non interactif (`claude -p --output-format stream-json --resume`), les données vivent dans une base SQLite du dossier de recherche (`tools/donnees.py`), et la veille ne réveille l'agent que pour les annonces jamais vues.

Variables utiles : `APPARTHUNT_WORKSPACE` (autre dossier de recherche), `APPARTHUNT_USER_DATA` (autres réglages et connexions, pour une deuxième copie de l'appli), `APPARTHUNT_DEBUG_PORT` (port de débogage local, `0` pour le couper).

## Arborescence

| Dossier | Contenu |
|---|---|
| `app/` | L'appli de bureau (Electron) : conversation, annonces, carte, veille |
| `agent/` | L'agent Python : outils, notation, zone, base SQLite, sites |
| `.claude/skills/agent-locataire/` | Le skill qui fait de Claude Code le cerveau de l'agent |
| `page/template.html` | La page à partager (carte, filtres, « Pour toi ») |
| `tools/` | Données, ajout d'annonces, zone et positions, dossier locataire |
| `examples/` | Critères, profil, zone et annonces fictifs pour essayer |
| `dossier/` | Mode d'emploi du dossier locataire (les pièces ne sont jamais versionnées) |
| `sites.md` | Les sites et canaux pour chercher une location en France |

## À venir

- L'agent qui regarde les photos (lumière, état, vrai étage, photos de catalogue)
- Une évaluation de l'agent sur des annonces réelles déjà jugées à la main
- Des outils dédiés pour d'autres sites

## Avertissement

Les sites d'annonces encadrent l'usage automatisé de leurs pages dans leurs conditions d'utilisation. AppartHunt est un outil personnel : il navigue au rythme d'une personne, dans ton navigateur et avec ta session, et ne publie ni ne redistribue aucune annonce. Vérifie les conditions des sites que tu utilises.

Licence MIT. Leaflet (`app/vendor/leaflet`) est sous sa propre licence BSD.
