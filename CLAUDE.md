# Gleamvault — consignes pour Claude

Gleamvault (ex-Pokéfolio) : app web installable (PWA) pour suivre sa collection de cartes à collectionner (Pokémon, Magic, One Piece) — recherche, prix, scan, wishlist, comptes synchronisés. En ligne sur https://aj2chart.github.io/pokefolio/ (GitHub Pages, branche `main`).

Notes complètes, historique des décisions et schéma des connexions : documents du Projet claude.ai « Gleamvault » (`claude/pokefolio-notes.md`, `claude/pokefolio-architecture.md`) et page de notes https://claude.ai/artifact/GTX48nTMYfvcTdkUkd9y5a. Les relire avant un chantier.

## Façon de travailler (demandée par l'utilisateur)
- Répondre en français, simplement : l'utilisateur n'est pas développeur.
- **Au début de chaque réponse, donner le temps estimé** pour traiter la demande.
- **Ne jamais lancer une commande sans l'avoir expliquée avant en mots simples** (ce qu'elle fait, sur quoi, si elle modifie quelque chose). Pas de commandes « au pif ».
- **Ne jamais publier sans l'accord explicite de l'utilisateur** : `git push` sur `main` met l'app en ligne pour tout le monde.
- D'autres sessions Claude modifient aussi le dépôt : toujours `git pull` avant de travailler.
- Vérifier et optimiser le code de temps en temps si sa taille ou sa complexité ralentit le travail.

## Le code
- `index.html` : page + CSS (aucun script : la politique de sécurité CSP l'interdit ; jamais d'attribut `on…=`, utiliser `data-err` / `data-act` ou `addEventListener`).
- `app.js` : toute l'application. `boot.js` : démarrage (police, écran de lancement). `sw.js` : service worker (cache `gleamvault-vNN`, à incrémenter si `sw.js`, les icônes ou le manifeste changent).
- `supabase/*.sql` : tables et règles d'accès (lancées à la main par l'utilisateur dans Supabase). `supabase/functions/notify-prices/` : éditer `src/`, puis `node tools/build-push.mjs` génère `index.ts` (à coller dans Supabase par l'utilisateur).
- Noms internes à ne pas changer (données des utilisateurs) : clés `pf_*`, base IndexedDB `pokefolio`, table `user_data`.
- Supabase : seule la clé publique est dans le code ; ne jamais y mettre de clé secrète.
- Vérification de syntaxe : `node --check app.js`.

## Publier une version
1. Remplacer la version partout dans `index.html` (meta `app-version`, commentaire `APP_VERSION = '…'`, `?v=` de `app.js` et `boot.js`) : format `AAAA.MM.JJ-NNN`, numéro suivant.
2. `MIN_VERSION` (meta `app-min-version`) : seulement pour un changement critique (format de synchro), sinon ne pas toucher.
3. Lancer les tests (ci-dessous), commit `v-NNN: …` en français, puis demander l'accord avant `git push`.

## Tests (dans `tests/`, toujours dans le dépôt, jamais seulement dans /tmp)
- `python3 tests/controle_beton.py` : contrôle complet (≈ 22 min). `--quick` pour itérer, `--selftest` pour vérifier que chaque détecteur attrape un vrai bug, `--only <détecteur>`.
- `node tests/push_t.mjs` : notifications de prix côté serveur.
- `python3 tests/v150_t.py [--slow]` : non-régression v-150.
- Tout bug trouvé laisse un test permanent qui le reproduit (vérifié en échec sur l'ancienne version).

## Contrôle béton
Vérification complète après une grosse évolution, quand l'utilisateur le demande (skill `controle-beton` du compte). Étapes : inventaire des nouveautés depuis le dernier contrôle (chacune avec un test), tous les tests, contrôle dédié dans toutes les combinaisons (petit téléphone / téléphone / PC × sombre / clair × FR / EN × Mode Safe, données extrêmes, appareil ralenti), corrections puis tout relancer, mise à jour de la doc (notes du Projet, schéma, README, page de notes), sauvegarde sur une branche `sauvegarde-AAAA-MM-JJ` vérifiée sur GitHub, compte rendu (vérifié, corrigé, à surveiller, non testable et comment le valider). Zéro alerte tolérée, rapports jamais tronqués.
