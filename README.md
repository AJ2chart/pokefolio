# Gleamvault

Suivi de collection de cartes à collectionner (Pokémon, Magic: The Gathering, One Piece), installable sur PC et téléphone.

**App :** https://aj2chart.github.io/pokefolio/

- Bases de cartes françaises et anglaises séparées (API [TCGdex](https://tcgdex.dev)), extensions récentes incluses
- Prix Cardmarket et TCGplayer mis à jour chaque jour, fourchette de prix, liens vers les ventes réussies eBay
- Scan d'une carte par photo (lecture du nom et du numéro dans le navigateur, gratuite)
- Cartes gradées (PSA, CGC, BGS, CCC, PCA, Collect Aura), alertes de prix, wishlist, historique
- Partage de la wishlist : image à envoyer ou lien vers une page publique en lecture seule
- Scan : lecture du numéro et reconnaissance par l'image (empreintes calculées chaque nuit par GitHub Actions, `tools/`, `hashes/`)
- Présentation guidée au premier lancement et écran « Quoi de neuf ? » après les grosses mises à jour
- Plusieurs jeux : Pokémon (TCGdex), Magic: The Gathering (Scryfall) et One Piece (OPTCG API, édition anglaise, prix TCGplayer convertis en euros au taux BCE du jour) ; choix du jeu dans Ajouter ; avec plusieurs jeux, boutons « Tous / Pokémon / Magic » qui filtrent Collection, Wishlist et Valeur
- Compte gratuit pour synchroniser sa collection entre appareils (Supabase), ou usage sans compte sur un seul appareil

## Structure
- `index.html` : la page (HTML et CSS) ; `app.js` : le code de l'application ; `boot.js` : démarrage (police, écran d'accueil)
- `sw.js`, `manifest.webmanifest`, `icons/` : app installable (PWA)
- `supabase/schema.sql` : table et règles d'accès des comptes
- `supabase/share.sql` : wishlists partagées par lien (lecture par jeton uniquement)
- `supabase/delete_account.sql` : suppression de son compte depuis l'app
- `supabase/push.sql` : notifications de prix (appareils abonnés) et historique des prix
- `supabase/functions/notify-prices/` : fonction serveur des notifications ; éditer `src/`, puis `node tools/build-push.mjs` génère `index.ts`
- `tools/` : empreintes des cartes pour le scan (`hash-cards.mjs`, `phash.mjs`) et des bibliothèques (`sri.mjs`) ; `.github/workflows/` : tâches automatiques (empreintes, maintien de Supabase éveillé)

Les images et noms des cartes sont © The Pokémon Company / Nintendo / Creatures / GAME FREAK. Projet de fan non officiel, non affilié.
