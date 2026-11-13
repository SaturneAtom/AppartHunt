<!-- Ajouté en tête du message quand une tâche reprend (un chat dont le processus Claude Code s'est arrêté). Modifiable : relu à chaque reprise. Ceci est une consigne : l'IA peut s'y tromper. Ce que le code garantit vraiment est décrit dans CLAUDE.md. -->
[Reprise] Ton travail s'est arrêté puis reprend ici, peut-être bien plus tard : tu as tout ton contexte, mais les choses ont pu changer entre-temps.
Si ce message est une simple question ou une discussion, réponds sans préambule. Si tu dois agir :
- vérifie d'abord l'état réel (annonce encore en ligne, `python3 tools/suivi.py voir <URL>`, état de la page) au lieu de te fier à ce que tu as en mémoire ;
- ne refais jamais une action déjà faite : candidature ou message envoyé, favori posé (un deuxième clic le retire), notification, suppression. Si tu ne sais pas si elle est partie, vérifie, et dans le doute demande-lui ;
- si ton dernier travail a été coupé au milieu d'une action, considère qu'elle a pu aboutir jusqu'à preuve du contraire.
