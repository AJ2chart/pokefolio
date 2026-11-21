# Gleamvault

Suivi de collection Pokémon TCG, installable sur PC et téléphone.

**App :** https://aj2chart.github.io/pokefolio/

- Bases de cartes françaises et anglaises séparées (API [TCGdex](https://tcgdex.dev)), extensions récentes incluses
- Prix Cardmarket et TCGplayer mis à jour chaque jour, fourchette de prix, liens vers les ventes réussies eBay
- Scan d'une carte par photo (lecture du nom et du numéro dans le navigateur, gratuite)
- Cartes gradées (PSA, CGC, BGS, CCC, PCA, Collect Aura), alertes de prix, wishlist, historique
- Partage de la wishlist : image à envoyer ou lien vers une page publique en lecture seule
- Compte gratuit pour synchroniser sa collection entre appareils (Supabase), ou usage sans compte sur un seul appareil

## Structure
- `index.html` : toute l'application (HTML, CSS, JS)
- `sw.js`, `manifest.webmanifest`, `icons/` : app installable (PWA)
- `supabase/schema.sql` : table et règles d'accès des comptes
- `supabase/share.sql` : wishlists partagées par lien (lecture par jeton uniquement)

Les images et noms des cartes sont © The Pokémon Company / Nintendo / Creatures / GAME FREAK. Projet de fan non officiel, non affilié.
