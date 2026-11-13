#!/bin/sh
# Garde-fou anti-clés : refuse un commit qui ajoute une clé d'API, un jeton, un mot de passe dans une URL ou un fichier .env.
# Appelé avant chaque commit (core.hooksPath global : ~/.config/git/hooks). En connaissance de cause : git commit --no-verify

FICHIERS='(^|/)\.env(\.local|\.production|\.prod|\.dev|\.development|\.staging|\.test)?$|\.pem$|\.p12$|\.pfx$|(^|/)id_(rsa|dsa|ecdsa|ed25519)$|(^|/)credentials(\.json)?$|service-account[^/]*\.json$|(^|/)\.aws/'
CLES='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9])sk-(proj-)?[A-Za-z0-9_-]{40,}|csk-[a-z0-9]{40,}|r8_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|AIza[0-9A-Za-z_-]{35}|xox[bapr]-[0-9]{6,}-[0-9A-Za-z-]{10,}|[sr]k_live_[0-9A-Za-z]{20,}|SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp)://[^:/ "'"'"']+:[^@ "'"'"']{3,}@'
CLES_I='aws_secret_access_key["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9/+]{40}|(api[_-]?key|secret|token|password|passwd)["'"'"' ]*[:=] *["'"'"'][A-Za-z0-9_+/=.-]{24,}["'"'"']'
EXEMPLES='REDACTED|EXAMPLE|example|your[_-]|xxxx|<[A-Z_]+>|placeholder|1234567890'

bloque=0
fichiers=$(git diff --cached --name-only --diff-filter=ACMR | grep -E "$FICHIERS" | grep -v -E '\.example$|\.sample$|\.template$')
if [ -n "$fichiers" ]; then
  echo "Commit refusé : fichier(s) de secrets ajouté(s) :"; echo "$fichiers" | sed 's/^/  /'
  echo "  → retire-le(s) (git restore --staged <fichier>) et ajoute-le(s) au .gitignore."; bloque=1
fi
ajouts=$(git diff --cached -U0 --no-color --diff-filter=ACMR -- . ':(exclude)*package-lock.json' ':(exclude)*.lock' ':(exclude)*yarn.lock' 2>/dev/null \
  | awk '/^\+\+\+ b\//{f=substr($0,7)} /^\+[^+]/{print f": "substr($0,2)}')
trouves=$( { printf '%s\n' "$ajouts" | grep -E "$CLES"; printf '%s\n' "$ajouts" | grep -i -E "$CLES_I"; } | grep -v -E "$EXEMPLES" | sort -u)
if [ -n "$trouves" ]; then
  echo "Commit refusé : une clé ou un mot de passe est dans les lignes ajoutées :"
  printf '%s\n' "$trouves" | sed -E 's/([A-Za-z0-9_+\/=-]{6})[A-Za-z0-9_+\/=.-]{8,}/\1…/g' | cut -c1-160 | sed 's/^/  /'
  echo "  → mets la valeur dans une variable d'environnement (fichier .env ignoré par git), pas dans le code."; bloque=1
fi
[ $bloque -eq 0 ] || { echo "  (en connaissance de cause seulement : git commit --no-verify)"; exit 1; }
exit 0
