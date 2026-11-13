# Dossier locataire

Dépose tes pièces dans `ma-recherche/dossier/pieces/` (PDF, JPG ou PNG) en les nommant comme ci-dessous, puis lance :

```
python3 tools/dossier.py
```

Le script vérifie ce qui manque et fabrique `ma-recherche/dossier/dossier-locataire.pdf` (page de garde + pièces dans l'ordre).
**Ce dossier n'est jamais poussé sur GitHub** (il est dans `.gitignore`).

## Tes pièces — `ma-recherche/dossier/pieces/`

| Fichier | Pièce |
|---|---|
| `1-identite` | Carte d'identité ou passeport (recto-verso) |
| `2-domicile` | 3 dernières quittances de loyer, ou attestation d'hébergement |
| `3-contrat` | Contrat de travail ou attestation employeur |
| `4-salaire-1`, `4-salaire-2`, `4-salaire-3` | 3 derniers bulletins de salaire |
| `5-impots` | Dernier avis d'imposition |

## Garant — `ma-recherche/dossier/pieces/garant/`

Soit **Visale** (gratuit, Action Logement) : un seul fichier `visa-visale`. Soit une personne : mêmes 5 pièces que toi.

## Infos pour la page de garde — `ma-recherche/dossier/profil.txt`

Remplis-le toi-même (nom, situation, revenus, date d'arrivée souhaitée). Je ne l'invente pas.

## Interdit de te demander

Relevés bancaires, photo, carte Vitale, chèque de réservation, attestation de bonne tenue de compte. Si on te les demande, méfiance.
