'use strict';
if(window.top!==window.self){try{window.top.location.replace(location.href)}catch(_){document.documentElement.innerHTML='<body style="font:16px system-ui;padding:24px"><a href="'+location.href.replace(/"/g,'')+'" target="_top" rel="noopener">Gleamvault</a></body>'}throw new Error('framed')}
/* No inline code anywhere (the security policy forbids it, so injected event attributes (onerror, onclick…) never run):
   picture fallbacks and the few action buttons are handled here. data-err: pf = try the next picture source, rm = drop
   the picture, rmp = drop its parent. A picture can finish loading before it is in the page (template built aside):
   checked when it is added. */
function imgEv(el,ok){const a=el.dataset.err,k=el.src+'|'+ok;if(!a||el.__k===k)return;el.__k=k;   // each outcome of each source handled once
  if(a==='pf')ok?pfImgLoad(el):pfImgErr(el);else if(!ok)a==='rmp'?el.parentNode?.remove():el.remove()}
document.addEventListener('load',e=>{if(e.target instanceof HTMLImageElement)imgEv(e.target,true)},true);
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement)imgEv(e.target,false)},true);
new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){if(n.nodeType!==1)continue;
  for(const im of n.matches?.('img[data-err]')?[n]:n.querySelectorAll?.('img[data-err]')||[])if(im.complete&&im.src)imgEv(im,im.naturalWidth>0)}}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-act]');if(b&&b.dataset.act==='reload')location.reload()});
/* error journal (Settings → Help): the last 20 errors, kept on the device, to diagnose a problem seen on a phone */
function logErr(msg,src){try{const l=JSON.parse(localStorage.getItem('pf_errlog')||'[]');l.unshift({t:Date.now(),v:typeof APP_VERSION==='string'?APP_VERSION:'',m:String(msg||'').slice(0,300),s:String(src||'').slice(0,200),h:location.hash});localStorage.setItem('pf_errlog',JSON.stringify(l.slice(0,20)))}catch(_){}}
addEventListener('error',e=>{if(e.message)logErr(e.message,(e.filename||'').split('/').pop()+':'+e.lineno+':'+e.colno)});
addEventListener('unhandledrejection',e=>{const r=e.reason;logErr('promise: '+(r&&(r.message||r.name)||r),r&&r.stack&&String(r.stack).split('\n').slice(0,3).join(' | '))});
/* ============ constants ============ */
const API = 'https://api.tcgdex.net/v2';
const APP_VERSION = document.querySelector('meta[name=app-version]')?.content||'0';
// oldest version still allowed to run: raise it to APP_VERSION only for a critical change (e.g. sync data format).
// Older apps then show a blocking « update needed » screen and stop syncing until updated.
const MIN_VERSION = document.querySelector('meta[name=app-min-version]')?.content||'0';
const INDEX_TTL = 24*3600*1000;
const INDEX_VER = 2; // bump when the cached index format changes
const AUTO_REFRESH = 20*3600*1000;   // prices change once a day at the sources: one automatic refresh a day is enough (was 12 h)
// Data Saver (Android « Lite mode » / « Économiseur de données »): nothing is downloaded on the app's own initiative
const saveData=()=>!!(navigator.connection&&navigator.connection.saveData);
const INDEX_MAX_AGE=7*864e5;   // the card list is downloaded again at least once a week, and sooner if the sets changed
const LANG_NAMES={fr:'Français',en:'English',ja:'日本語'};
const FLAGS = {
  fr:'<svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ed2939"/></svg>',
  ja:'<svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice"><rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r=".6" fill="#bc002d"/></svg>',
  en:'<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><rect width="60" height="30" fill="#012169"/><path d="M0 0l60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30M60 0L0 30" stroke="#C8102E" stroke-width="2.4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>'
};
const CONDITIONS = ['MT','NM','EX','GD','LP','PL','PO'];
const VARIANTS = ['normal','reverse','holo','firstEdition','foil'];
/* ============ games: Pokémon (TCGdex) and Magic (Scryfall). A card's game comes from its id: Magic ids start with "mg:" ============ */
const GAMES={pk:{n:'Pokémon',ab:'PK',c:'#FFCB3D',langs:['fr','en','ja']},mg:{n:'Magic',ab:'MG',c:'#E08A4F',langs:['fr','en']},op:{n:'One Piece',ab:'OP',c:'#D9534F',langs:['fr','en','ja']}};
const gameOf=x=>{const s=String(typeof x==='string'?x:(x?.cardId||''));return s.startsWith('mg:')?'mg':s.startsWith('op:')?'op':'pk'};
// per-task caches: tiles ask for these thousands of times during one render (was O(n²) with big collections).
// Valid for the current task only (cleared on the next microtask) and dropped if the collection array changes.
const taskCache=(build)=>{let v=null,ref=null,len=-1;return()=>{if(v===null||ref!==collection||len!==collection.length){v=build();ref=collection;len=collection.length;queueMicrotask(()=>{v=null})}return v}};
const gamesUsed=taskCache(()=>new Set(collection.map(gameOf)));
const multiGame=()=>gamesUsed().size>1;
// hybrid view: with one game nothing changes; with several, a pill in the header switches between "all games" and one game
const gvActive=()=>multiGame()&&settings.gameView&&settings.gameView!=='all'&&gamesUsed().has(settings.gameView);
const inView=e=>!gvActive()||gameOf(e)===settings.gameView;
const gameOn=()=>true;   // the game picker in Ajouter is always there: it is how a second game is discovered
const gdot=g=>`<span class="gdot" style="background:${GAMES[g].c}" aria-hidden="true">${GAMES[g].ab}</span>`;

/* ============ i18n ============ */
const I18N = {
fr:{
 nav_collection:'Collection',nav_add:'Ajouter',nav_wish:'Wishlist',nav_evo:'Valeur',nav_data:'Réglages',
 stat_value:'Valeur estimée',stat_cost:"Coût d'achat",
 refresh:'Actualiser les prix',refreshing:'Actualisation… {p}/{t}',
 my_collection:'Ma collection',empty_collection:"Ta collection est vide pour l'instant.",go_add:'Ajouter une carte',
 filter_collection:'Filtrer ma collection…',all_sets:'Toutes les extensions',all_langs:'Toutes les langues',
 sort_value:'Valeur décroissante',sort_name:'Nom A → Z',sort_added:'Ajout le plus récent',sort_gain:'Plus-value décroissante',sort_set:'Extension',
 no_movers:'Les variations apparaîtront après quelques jours d’actualisation des prix.',
 add_title:'Ajouter une carte',search_ph:'Rechercher une carte',card_lang:'Langue des cartes',
 loading_index:'Chargement de la base de cartes {l}…',
 no_results:'Aucune carte trouvée.',nr_clear:'Retirer les filtres',f_reset:'Réinitialiser les filtres',qa_title:'Ajouter 1 exemplaire à ma collection',qa_added:'« {n} » ajoutée à ta collection',ah_sets:'Dernières extensions',ah_cards:'cartes',ah_recent:'Vues récemment',ah_clear:'Effacer',nr_in:'Voir les cartes {f} {l}',type_to_search:'Tape un nom de carte, une extension ou un numéro (ex. 199/165).',results:'{n} résultat(s)',
 lang_fr:'françaises',lang_en:'anglaises',lang_ja:'japonaises',ja_hint:'Cartes japonaises : tape le nom en français (ex. Dracaufeu), le nom japonais (リザードン), le code de l’extension ou le numéro.',ja_searching:'Recherche des cartes correspondantes dans cette langue…',ja_note:'Les prix et les images des cartes japonaises sont moins complets que pour les cartes françaises et anglaises.',
 set:'Extension',number:'Numéro',rarity:'Rareté',illustrator:'Illustrateur',
 cm_title:'Cardmarket (EUR)',tcp_title:'TCGplayer (USD)',trend:'Tendance',low:'Plus bas',avg7:'Moy. 7 j',avg30:'Moy. 30 j',avg1:'Moy. 1 j',
 reverse_holo:'Reverse / Holo',range:'Fourchette de prix estimée',range_note:'Basée sur les moyennes de ventes Cardmarket (1, 7, 30 jours) et la tendance.',
 no_price:'Pas de prix disponible pour cette carte.',tcp_only_lab:'Prix TCGplayer converti',tcp_only_msg:'Pas encore de prix Cardmarket pour cette carte (fréquent sur les extensions toutes récentes) : c’est le prix du marché américain TCGplayer, converti en euros, à titre indicatif.',tcp_only_tip:'Prix TCGplayer converti : pas encore de prix Cardmarket',price_upd:'Prix du {d}',
 variant:'Version',condition:'État',qty:'Quantité',buy_price:"Prix d'achat unitaire (€)",buy_date:"Date d'achat",notes:'Notes',status:'Statut',
 owned:'Possédée',wish:'Dans ma wishlist',add_btn:'Ajouter à ma collection',edit:'Modifier',chk_short:'Prix à vérifier',chk_why:'Pourquoi ?',mg_via:'Cartes trouvées sous le nom « {n} ».',mg_other_langs:'Pas de carte à ce nom dans cette langue : recherche dans les autres langues…',mg_via_n:'Noms anglais des cartes dont le nom contient « {q} » : {n}.',mg_via_more:'et {n} autres',nr_in_sets:'« {q} » existe dans d’autres extensions :',clear_search:'Effacer la recherche',mg_fallback:'Pas de version française répertoriée pour cette recherche : voici les cartes en anglais.',mgv_serial:'Numérotée',mgv_borderless:'Sans bordure',mgv_showcase:'Vitrine',mgv_extended:'Illustration étendue',mgv_fullart:'Full art',mgv_etched:'Gravée',mgv_prerelease:'Avant-première',mgv_promo:'Promo',scan_mg_name:'Nom lu : « {q} »',scan_mg_tips:'Astuce : cadre bien le bas de la carte (numéro, code d’extension et langue), à plat et bien éclairé.',mg_rar_all:'Toutes les raretés',mg_special:'Versions spéciales',mg_special_hint:'Sans bordure, vitrine, illustration étendue, full art, numérotées…',v_foil:'Foil',game_all:'Tous les jeux',game_all_s:'Tous',game_pick:'Choisir le jeu',n_card1:'{n} carte',ev_game:'Jeu',mg_ph:'Rechercher une carte Magic…',mg_hint:'Tape le nom d’une carte Magic (en français ou en anglais), ou choisis une extension.',mg_src:'Données et prix : Scryfall (prix Cardmarket).',mg_none:'Aucune carte trouvée. Essaie le nom anglais, ou l’autre langue.',mg_more:'Voir plus',share:'Partager',share_tab_img:'Image',share_tab_link:'Lien',share_sel_all:'Toute la wishlist (8 premières + « +N »)',share_sel_n:'{n} carte(s) choisie(s)',share_pick:'Choisir les cartes',share_pick_d:'Touche les cartes pour les ajouter ou les retirer de l’image. Au-delà de 9, l’image montre les 8 premières et « +N ».',share_pick_auto:'Choix automatique',share_pick_ok:'Valider',share_pick_more:'8 affichées + « +N »',share_img_t:'Ma wishlist',share_img_prio:'= prioritaire',share_img_src:'Prix moyens Cardmarket',share_img_made:'Fait avec Gleamvault',share_img_send:'Partager l’image',share_img_dl:'Image téléchargée',share_prev:'Voir la page telle que la verra la personne',share_prev_ban:'Aperçu : voici ce que verra la personne qui ouvre ton lien.',share_prev_back:'Retour',share_t:'Partager ma wishlist',share_need_acc:'Le lien de partage a besoin d’un compte gratuit : c’est lui qui garde la page à jour.',share_link_d:'Crée un lien vers une page qui affiche ta wishlist, à jour à chaque modification. Toute personne qui a le lien peut la voir, sans compte.',share_prices:'Afficher les prix',share_make:'Créer le lien',share_err:'Impossible de créer le lien pour l’instant.',share_live:'Ton lien est actif. La page se met à jour toute seule quand ta wishlist change.',share_send:'Envoyer le lien',share_off:'Désactiver le lien',share_off_q:'Désactiver le lien ? La page ne sera plus visible. Un nouveau lien (différent) pourra être créé plus tard.',share_unavail:'Le partage par lien n’est pas encore activé sur le serveur.',share_title:'Ma wishlist Gleamvault',copy:'Copier',copied:'Lien copié',shared_t:'Wishlist partagée',shared_gone:'Ce lien n’existe pas ou a été désactivé.',shared_cta:'Découvrir Gleamvault',shared_made:'Wishlist créée avec Gleamvault, l’app pour suivre sa collection de cartes.',shared_budget:'budget',shared_upd:'mise à jour le {d}',chk_pill_l:'à vérifier',chk_pill_tip:'{n} carte(s) au prix à vérifier : voir la liste',chk_tip:'Le prix Cardmarket semble erroné pour cette rareté : carte exclue de la valeur. Ouvre la fiche pour vérifier.',chk_tcp_tip:'Prix Cardmarket suspect : prix TCGplayer utilisé (converti en euros)',chk_alt_lab:'Prix TCGplayer (converti)',chk_msg:'⚠ Cardmarket affiche {v}, un prix invraisemblable pour une carte « {r} ». La base de prix associe probablement cette carte au mauvais produit (fréquent sur les extensions toutes récentes). Elle est exclue de la valeur de ta collection : vérifie les ventes et utilise ton prix.',chk_msg_alt:'⚠ Cardmarket affiche {v}, un prix invraisemblable pour une carte « {r} ». L’app utilise le prix TCGplayer à la place. Vérifie les ventes et utilise ton prix si besoin.',chk_val:'{n} carte(s) au prix à vérifier, exclue(s) du total',chk_val_alt:'{n} au prix TCGplayer',chk_list:'Prix à vérifier',chk_list_d:'Le prix Cardmarket de ces cartes semble erroné pour leur rareté (souvent sur les extensions toutes récentes). Ouvre une carte pour voir ses ventes eBay et utiliser ton prix.',chk_excluded:'exclue du total',sold_t:'Ventes conclues sur eBay',sold_d:'Les prix auxquels la carte s’est vraiment vendue',sold_see:'Voir',buy_t:'Disponibles à l’achat sur eBay',buy_d:'Annonces en cours, les moins chères d’abord (port compris)',buy_sold:'Ventes conclues pour comparer',al_short:'Alerte',sold_login:'Connexion eBay demandée (une seule fois)',sold_alt:'Sans compte : 130point',my_q:'Tu as constaté un autre prix ?',my_cta:'Utiliser mon prix',my_label:'Mon prix constaté (par exemplaire)',my_src:'Vu sur',src_ebay:'eBay vendu',src_vinted:'Vinted',src_cm:'Cardmarket',src_shop:'Boutique',src_other:'Autre',my_use:'Utiliser ce prix',my_price:'Mon prix',my_price_l:'mon prix',my_est:'Estimation Cardmarket : {v}',my_gap:'d’écart',my_cal:'Calé sur le marché : {g} vs Cardmarket',my_cal2:'Saisi {v} le {d} · Cardmarket aujourd’hui {e}',my_fixed:'Prix fixe (pas d’estimation Cardmarket à suivre)',my_clear:'Revenir à l’estimation',my_saved:'Ton prix est calé : il suivra désormais le marché',my_cleared:'Retour à l’estimation Cardmarket',man_tag:'Manuelle',man_hint:'Ta carte est très récente et pas encore dans la base ?',man_hint_link:'Ajoute-la manuellement',man_add:'Ajouter une carte manuellement',man_form_d:'Pour une carte trop récente pour être dans la base. Elle sera reliée automatiquement à la vraie carte dès son arrivée.',man_name:'Nom de la carte',man_set_other:'Autre / pas encore dans la liste',man_set_name:'Nom de l’extension (optionnel)',man_num:'Numéro',man_value:'Valeur manuelle (optionnel)',man_value_ph:'Sinon, pas comptée dans la valeur',man_note:'Sans valeur manuelle, la carte ne compte pas dans la valeur de ta collection tant qu’elle n’est pas reliée.',man_added:'« {n} » ajoutée manuellement',man_list:'Cartes manuelles',scan_rec_t:'Cartes qui ressemblent à ta photo',scan_rec_d:'Touche la bonne carte pour l’ouvrir.',scan_rec_only:'Texte illisible, mais voici les cartes les plus proches de ta photo',scan_rec_hi:'Très proche',scan_rec_mid:'Proche',scan_rec_lo:'Possible',rl_title:'Journal des actualisations',rl_row_d:'Ce qui a changé dans la valeur aux dernières actualisations',rl_d:'Valeur de la collection avant → après chaque actualisation des prix, et les cartes qui ont le plus bougé, avec l’origine de leur prix. Utile pour comprendre une variation.',rl_cards:'{n} cartes actualisées',rl_failed:'{n} sans réponse',rl_nomove:'Aucune carte n’a changé de prix.',rl_none:'Pas encore d’actualisation enregistrée.',el_title:'Journal des erreurs',del_acc:'Supprimer mon compte',del_acc_d:'Ton compte, ta collection synchronisée et ta wishlist partagée seront supprimés définitivement de nos serveurs. Tes cartes restent sur cet appareil (mode invité) : exporte une sauvegarde si tu veux les garder ailleurs.',del_acc_type:'Pour confirmer, écris {w} :',del_acc_word:'SUPPRIMER',del_acc_btn:'Supprimer définitivement',del_acc_done:'Compte supprimé. Tes cartes restent sur cet appareil.',del_acc_missing:'La suppression n’est pas encore activée sur le serveur. Réessaie plus tard.',coll_loading:'Chargement de ta collection…',el_row_d:'{n} erreur(s) enregistrée(s) sur cet appareil',el_row_d1:'1 erreur enregistrée sur cet appareil',el_d:'Les dernières erreurs rencontrées par l’app sur cet appareil. En cas de souci, copie-les et envoie-les.',el_none:'Aucune erreur enregistrée.',el_copy:'Copier',el_copied:'Journal copié',el_clear:'Effacer',coll_stuck_t:'Collection momentanément illisible',coll_stuck_d:'Le stockage de ton téléphone n’a pas répondu. Ta collection est intacte : ferme puis rouvre l’app.',coll_stuck_btn:'Recharger',coll_stuck_save:'Recharge l’app avant de modifier ta collection.',bk_text:'Tes {n} cartes ne sont enregistrées que sur cet appareil. Garde-les à l’abri :',bk_account:'Créer un compte gratuit',bk_export:'Exporter',bk_later:'Plus tard',offline_refresh:'Pas de connexion : les prix seront actualisés au retour du réseau.',scan_mg_prints:'Cette illustration existe dans plusieurs impressions : touche la tienne.',scan_mg_byname:'Chercher plutôt « {q} »',upd_avail:'Nouvelle version',upd_btn:'Mettre à jour',upd_force_t:'Mise à jour nécessaire',upd_force_d:'Cette version de Gleamvault n’est plus compatible. Mets-la à jour pour continuer : ta collection est conservée et la synchronisation reprendra ensuite.',upd_force_off:'Pas de connexion : la mise à jour se fera dès que tu seras en ligne.',rl_safe:'Mode prix masqués : seul le nombre de cartes actualisées est affiché.',rl_s_cm:'Cardmarket',rl_s_tcp:'TCGplayer',rl_s_chk_tcp:'TCGplayer (prix suspect)',rl_s_chk_out:'exclue (prix à vérifier)',rl_s_my:'mon prix',rl_s_man:'valeur manuelle',rl_s_none:'sans prix',ni_title:'Cartes sans visuel',ni_row_d:'Cartes dont l’image est introuvable pour l’instant',ni_d:'Images introuvables chez nos sources (fréquent pour les cartes japonaises et les toutes récentes). Tu peux copier la liste et la signaler sur le Discord de TCGdex pour qu’elles soient ajoutées. La liste se met à jour quand tu parcours ta collection.',ni_copy:'Copier la liste',ni_copied:'{n} cartes copiées',ni_none:'Toutes tes cartes affichées ont un visuel.',man_list_d:'Reliées automatiquement à la vraie carte dès qu’elle arrive dans la base. Après {d} jours sans correspondance, l’app te demande si tu veux les garder.',man_row_d:'Cartes ajoutées à la main, en attente de la base',man_none:'Aucune carte manuelle.',man_noset:'Extension inconnue',man_age:'il y a {n} j',man_keep:'Garder',man_link_one:'Relier',man_found:'{n} carte(s) manuelle(s) maintenant dans la base',man_link_btn:'Relier',man_stale:'{n} carte(s) manuelle(s) toujours introuvable(s) après {d} jours',man_check:'Vérifier',man_linked:'{n} carte(s) reliée(s) à la base : image et prix ajoutés',pill_short:'Taille des pastilles',pill_d:'Pastilles et boutons posés sur les cartes.',guest:'Mode invité',guest_d:'Ta collection est enregistrée sur cet appareil uniquement.',have_account:'J’ai déjà un compte',safe_short:'Masque tous les prix',sec_wishalerts:'Wishlist et alertes',deal_short:'Baisse depuis l’ajout à la wishlist',notif_short:'Quand une alerte de prix se déclenche (app ouverte)',notif_blocked:'Notifications bloquées : autorise-les dans les réglages du navigateur.',sec_mydata:'Mes données',exp_json_d2:'Fichier avec toute ta collection ({n} cartes)',exp_json_d21:'Fichier avec toute ta collection (1 carte)',imp_d2:'Remplace la collection actuelle',data_note2:'Sans compte, pense à exporter une sauvegarde de temps en temps, et avant de changer de téléphone.',sec_help:'Aide',tour_again_t:'Revoir la présentation',ab_line:'Cartes Pokémon TCGdex · Cartes Magic Scryfall · Prix Cardmarket & TCGplayer · Images TCGdex, Scrydex & Scryfall · Scan Tesseract.js',deal_rule:'baisse ≥ {p} %',deal_cfg:'Bonnes affaires',deal_cfg_d:'Une carte de ta wishlist devient une bonne affaire quand son prix baisse de ce pourcentage depuis son ajout.',deal_cfg_n:'Une carte qui passe sous ton seuil d’alerte 🔔 est toujours une bonne affaire.',deal_saved:'Bonnes affaires : baisse de {p} % ou plus',ev_value:'Valeur de ma collection',n_cards:'{n} cartes',ev_no_period:'Pas assez d’historique sur cette période.',p_7:'7 j',p_30:'30 j',p_365:'1 an',p_all:'Tout',pl_7:'7 jours',pl_30:'30 jours',pl_365:'1 an',pl_all:'toute la période',ev_over:'Sur {p} :',ev_best:'Mes plus belles cartes',see_all:'Tout voir',see_less:'Voir moins',ev_moves:'Mouvements',ev_7d:'7 jours',ev_vs_buy:'vs prix d’achat',ev_up:'Hausses',ev_down:'Baisses',ev_gains:'Plus-values',ev_no_gain:'Ajoute un prix d’achat à tes cartes pour voir tes plus-values.',ev_see_n:'Voir les {n}',ev_rep:'Répartition',ev_lang:'Langue',rar_none:'Sans rareté',others:'Autres ({n})',ev_deals:'{n} en bonne affaire',deals_title:'Bonnes affaires ({n})',deal_hit:'sous ton seuil',prio:'Priorité',prio_on:'« {n} » marquée prioritaire',prio_off:'« {n} » n’est plus prioritaire',since_added:'Évolution depuis l’ajout à la wishlist (vert = baisse de prix)',tour_hi:'Bienvenue sur Gleamvault',tour_hi_d:'Ta collection de cartes (Pokémon, Magic…) dans ta poche : retrouve tes cartes, suis leur valeur et ne rate aucune bonne affaire. Petit tour en 1 minute ?',tour_go:'C’est parti',tour_skip:'Passer',tour_next:'Suivant',tour_try:'Essayer',tour_coll:'<b>Collection</b> : toutes tes cartes, avec leur valeur. Touche une carte pour voir sa fiche et tes exemplaires.',tour_add:'<b>Ajouter</b> : cherche une carte par son nom, son extension ou son numéro, ou scanne-la avec l’appareil photo.',tour_wish:'<b>Wishlist</b> : les cartes que tu cherches, avec leur budget, des alertes de prix 🔔 et un bouton pour la <b>partager</b> (image ou lien).',tour_safe:'<b>Mode Safe</b> : ce bouclier masque tous les prix d’un toucher. Pratique pour montrer ta collection sans dévoiler sa valeur.',tour_pick:'D’abord, choisis ton <b>jeu</b> (Pokémon, Magic…) puis la <b>langue de tes cartes</b> avec les drapeaux : c’est la langue imprimée sur la carte, tu peux taper son nom dans n’importe quelle langue.',news_t:'Quoi de neuf ?',news_op:'<b>One Piece arrive</b> : ajoute tes cartes One Piece, chaque version (parallèle, illustration alternative, manga) avec son propre prix. Choisis le jeu avec le petit bouton à gauche des drapeaux dans Ajouter.',news_fx:'<b>Prix en dollars convertis au taux du jour</b> de la Banque centrale européenne (One Piece et prix TCGplayer).',news_noimg:'<b>Cartes sans visuel</b> : retrouve-les dans Réglages → Aide, avec une liste à copier pour les signaler.',news_try_op:'Essayer One Piece',news_ok:'Compris',tour_value:'<b>Valeur</b> : l’évolution de ta collection, tes cartes les plus précieuses et les plus grosses variations.',tour_set:'<b>Réglages</b> : ton compte gratuit pour synchroniser ton téléphone et ton PC, le thème, la langue de l’app et tes sauvegardes.',tour_trial:'À toi de jouer',tour_search:'Prends une carte que tu as sous la main et tape son nom (ou son numéro, ex. 199/165) dans la barre de recherche.',tour_addit:'Trouve ta carte et touche le bouton <b>＋</b> pour l’ajouter. Tu peux aussi toucher la carte pour choisir la version et l’état.',tour_bravo:'Bravo !',tour_bravo_d:'Ta première carte est dans ta collection. Crée un compte gratuit pour la sauvegarder et la retrouver sur ton téléphone et ton PC.',tour_bravo_u:'Ta première carte est dans ta collection, et elle est déjà synchronisée avec ton compte.',tour_acc:'Créer un compte gratuit',tour_local:'Continuer sans compte',tour_local_d:'Sans compte, ta collection reste sur cet appareil. Tu pourras créer un compte plus tard dans Réglages, sans rien perdre.',tour_end:'Voir ma collection',al_active:'Alerte active',del_one:'Retirer 1 exemplaire',deleted_n:'« {n} » retirée de ta collection',deleted_one:'1 exemplaire de « {n} » retiré',range_short:'Fourchette :',est_price:'Prix estimé',over_30d:'sur 30 jours',since_track:'depuis le suivi',price_detail:'Détail des prix',bought:'Achetée',on_date:'le {d}',manual_short:'Valeur manuelle',manual_tag:'manuel',my_copies:'Mes exemplaires',copies_value:'Valeur de mes exemplaires',add_copy:'Ajouter un exemplaire',added_from_wish:'« {n} » ajoutée à ta collection et retirée de ta wishlist',fs_hint:'Touche pour zoomer · glisse vers le bas pour fermer',fs_open:'Agrandir l’image',buy_notes:'Achat et notes (optionnel)',cta_wish:'Wishlist',in_wish:'Dans ma wishlist',add_wish_btn:'Ajouter à ma wishlist',added:'« {n} » ajoutée !',
 v_normal:'Normale',v_reverse:'Reverse',v_holo:'Holo',v_firstEdition:'1ʳᵉ édition',
 c_MT:'Mint',c_NM:'Near Mint',c_EX:'Excellent',c_GD:'Good',c_LP:'Light Played',c_PL:'Played',c_PO:'Poor',
 save:'Enregistrer',delete:'Supprimer',cancel:'Annuler',confirm:'Confirmer',close:'Fermer',saved:'Modifications enregistrées',
 unit_value:'Valeur unitaire',gain:'Plus-value',history:'Historique du prix',
 wish_title:'Ma wishlist',wish_empty:'Ta wishlist est vide. Dans « Ajouter », touche le cœur d’une carte pour l’y ajouter.',
 evo_title:'Valeur de la collection',see_value:'Détails',evo_empty:"Le graphique apparaîtra après quelques jours : un point est enregistré chaque jour où la collection ou les prix changent.",value:'Valeur',
 data_title:'Réglages',lang_label:'Langue de l’app',theme_label:'Thème',theme_dark:'Sombre',theme_light:'Clair',exp_json_t:'Exporter une sauvegarde',imp_t:'Restaurer une sauvegarde',exp_csv_t:'Exporter pour Excel',exp_csv_d:'Tableau lisible dans Excel ou Google Sheets.',notif_t:'Notifications',reload_t:'Recharger la base de cartes',reload_d:'Si une extension toute récente n’apparaît pas encore dans la recherche.',import_ok:'{n} cartes importées',import_ok1:'1 carte importée',import_bad:'Fichier invalide',
 import_confirm:'Remplacer ta collection actuelle ({a} entrées) par la sauvegarde ({b} entrées) ?',
 cache_cleared:'Base de cartes rechargée',
 sort_label:'Trier les résultats',ss_relevance:'Tri : pertinence',ss_num_desc:'Numéro décroissant (raretés d’abord)',ss_num_asc:'Numéro croissant',ss_newest:'Extensions récentes d’abord',ss_oldest:'Extensions anciennes d’abord',secret_only:'Cartes secrètes',secret:'Secrète',secret_hint:'Numéro au-delà du total officiel de l’extension (ex. 199/165) ou galerie spéciale : ce sont en général les raretés les plus recherchées.',credit_short:'Prix Cardmarket & TCGplayer via TCGdex, mis à jour chaque jour',credit_short_mg:'Prix Cardmarket & TCGplayer via TCGdex (Pokémon) et Scryfall (Magic), mis à jour chaque jour',credit_op:'One Piece : OPTCG API (prix TCGplayer convertis en euros au taux BCE du jour)',op_ph:'Nom ou numéro (OP09-118)',op_hint:'Tape un nom (ex. Luffy, Shanks), un surnom (ex. Barbe Blanche, Big Mom, Akainu) ou un numéro (ex. OP09-118, 118). Chaque version (parallèle, illustration alternative, manga) est une carte à part avec son propre prix.',op_src:'Données, visuels et prix : OPTCG API (édition anglaise, prix TCGplayer convertis en euros). Visuels officiels marqués « SAMPLE » par Bandai.',op_none:'Aucune carte trouvée. Les noms sont en anglais : essaie le nom anglais ou le numéro de la carte.',op_loading:'Chargement de la liste des cartes One Piece…',op_lang_note:'Les données One Piece viennent de l’édition anglaise : visuel et prix de la version anglaise, même numéro de carte.',op_special_hint:'Parallèles, illustrations alternatives, manga, spéciales',op_promos:'Promos',opv_par:'Parallèle',opv_alt:'Illustration alternative',opv_manga:'Manga',opv_sp:'Spéciale',ss_price:'Prix décroissant',tcp_only_msg_op:'Prix du marché américain TCGplayer pour l’édition anglaise, converti en euros au taux du jour de la Banque centrale européenne. Nos sources n’ont pas de prix Cardmarket pour One Piece.',scan_op_num:'Numéro lu : {n}',scan_op_tips:'Cadre bien le bas de la carte, où est imprimé le numéro (ex. OP09-118), avec une bonne lumière, ou tape le numéro dans la recherche.',about_more:'À propos',ab_ncards:'{n} cartes',ab_ncard1:'{n} carte',ab_legal:'Pokémon et les noms, images et marques associés sont la propriété de The Pokémon Company, Nintendo, Creatures et GAME FREAK. Magic: The Gathering est une marque de Wizards of the Coast. One Piece © Eiichiro Oda / Shueisha, Toei Animation ; One Piece Card Game © Bandai. Gleamvault est un projet de fan non officiel, sans lien avec ces sociétés.',
 price_unavailable:'prix indispo.',err_net:'Erreur réseau — vérifie ta connexion.',
 scan_btn:'Scanner une carte',scan_title:'Lecture de la carte',scan_loading:'Chargement du lecteur (la 1ʳᵉ fois, quelques secondes)…',scan_reading:'Lecture du nom et du numéro…',
 scan_fail:"Je n'ai pas réussi à identifier la carte.",scan_tips:'Astuce : cadre la carte en entier et bien droite, à plat, avec une bonne lumière et sans reflet. Tu peux aussi taper le numéro imprimé en bas (ex. 199/165).',
 scan_found:'Carte lue : « {q} » ({n} résultats), choisis la bonne.',
 scan_retry:'Carte full art ? Nouvelle tentative de lecture du numéro…',scan_again:'Reprendre une photo',
 account:'Compte',password_plain:'Mot de passe',pwd_confirm:'Confirme le mot de passe',signup_go:'Créer mon compte',no_account:'Pas encore de compte ?',have_account:'Déjà un compte ?',err_pwd_match:'Les deux mots de passe ne sont pas identiques.',auth_login:'Connexion en cours…',auth_signup:'Création du compte en cours…',err_timeout:'Le serveur ne répond pas. Vérifie ta connexion et réessaie dans un instant.',login:'Se connecter',signup:'Créer un compte',logout:'Se déconnecter',password:'Mot de passe (8 caractères min.)',show_pwd:'Afficher le mot de passe',hide_pwd:'Masquer le mot de passe',forgot_title:'Mot de passe oublié',forgot_why:'Indique l’e-mail de ton compte : tu recevras un lien pour choisir un nouveau mot de passe.',forgot_send:'Envoyer le lien',back:'Retour',err_fields_login:'Indique ton e-mail et ton mot de passe.',err_wait:'Pour ta sécurité, attends une minute avant de redemander un e-mail pour cette adresse.',err_pwd_len:'Le mot de passe doit faire au moins 8 caractères.',forgot:'Mot de passe oublié ?',new_pwd:'Nouveau mot de passe',
 account_why:'Crée un compte gratuit pour retrouver ta collection sur ton PC et ton téléphone. Sans compte, elle reste sur cet appareil.',
 check_mail:'Compte créé ! Clique sur le lien reçu par e-mail pour le confirmer, puis connecte-toi.',reset_sent:'E-mail envoyé : suis le lien pour choisir un nouveau mot de passe.',
 logged_in:'Connecté ! Synchronisation…',logged_out:'Déconnecté',sync_first:'Collection synchronisée ({n} entrées)',
 logout_q:'Se déconnecter de cet appareil ?',logout_keep:'Garder une copie sur cet appareil',logout_wipe:'Effacer de cet appareil',
 sync_now:'Synchroniser maintenant',sync_ok:'synchronisé à {d}',sync_running:'Synchronisation…',sync_error:'Échec de synchronisation (réessai automatique)',sync_off:'Non connecté',
 sb_unavailable:'Le service de comptes est inaccessible pour le moment (connexion internet ?).',
 err_login:'E-mail ou mot de passe incorrect.',err_confirm:"Confirme d'abord ton e-mail (lien reçu à l'inscription).",err_exists:'Un compte existe déjà avec cet e-mail : connecte-toi.',
 err_rate:'Limite d’envoi d’e-mails atteinte pour le moment : réessaie un peu plus tard (jusqu’à une heure).',err_pwd:'Mot de passe refusé',err_fields:'Indique un e-mail valide et un mot de passe de 8 caractères minimum.',err_email:'Indique ton e-mail.',
 copies:'{n} exemplaires de cette carte dans ta collection',owned_n:'Tu possèdes {n} exemplaire(s) de cette carte',quick_wish:'Ajouter à ma wishlist / retirer',add_short:'Ajouter',filters:'Filtres',priv_hide:'Activer le mode Safe',priv_show:'Désactiver le mode Safe',priv_on:'Mode Safe activé 🛡',priv_off:'Mode Safe désactivé',priv_t:'Mode Safe',safe_banner:'Mode Safe : prix masqués',safe_off_short:'Désactiver',safe_value:'Mode Safe activé : la valeur de la collection est masquée.',safe_prices:'Mode Safe : prix masqués.',ptr_pull:'Tire pour actualiser les prix',ptr_release:'Relâche pour actualiser',ptr_busy:'Actualisation des prix…',display:'Affichage',pill_size:'Taille des pastilles sur les cartes',pill_s:'Petite',pill_m:'Normale',pill_l:'Grande',wish_budget:'Budget pour compléter ta wishlist',wish_count:'{n} carte(s) à trouver',wish_remove:'Retirer de ma wishlist',alert_cfg:'Alerte de prix',al_below:'↓ En dessous de',al_above:'↑ Au-dessus de',al_on:'Activer l’alerte',al_off:'Désactiver',al_saved:'Alerte de prix enregistrée',al_removed:'Alerte de prix désactivée',undo:'Annuler',wish_added:'« {n} » ajoutée à ta wishlist',wish_removed:'« {n} » retirée de ta wishlist',reprint_short:'Réédition',reprint:'Réédition (numéro d’origine imprimé sur la carte)',
 more_opts:'Gradation & valeur manuelle (optionnel)',alert_section:'Alerte de prix (optionnel)',alert_hint:'Vérifiée à chaque actualisation des prix. Pratique pour guetter une baisse sur ta wishlist.',grader:'Société de gradation',raw:'Non gradée',grade:'Note',cert:'N° de certificat',
 manual_value:'Valeur manuelle (€)',auto:'auto (Cardmarket)',alert:'Alerte de prix',alert_none:'Aucune',alert_below:'Si le prix descend sous…',alert_above:'Si le prix monte au-dessus de…',alert_price:"Seuil d'alerte (€)",
 extra_hint:"Cardmarket ne donne que le prix des cartes non gradées : pour une carte gradée, indique une valeur manuelle (le lien eBay cherche les ventes avec la note).",
 
 alerts_title:'{n} alerte(s) de prix déclenchée(s)',alert_toast:'{n} alerte(s) de prix déclenchée(s) !',alert_msg:'{n} est à {v}',clear_alerts:'Effacer ces alertes',
 notif_off:'notifications indisponibles ici',
},
en:{
 nav_collection:'Collection',nav_add:'Add',nav_wish:'Wishlist',nav_evo:'Value',nav_data:'Settings',
 stat_value:'Estimated value',stat_cost:'Purchase cost',
 refresh:'Refresh prices',refreshing:'Refreshing… {p}/{t}',
 my_collection:'My collection',empty_collection:'Your collection is empty for now.',go_add:'Add a card',
 filter_collection:'Filter my collection…',all_sets:'All sets',all_langs:'All languages',
 sort_value:'Value (high → low)',sort_name:'Name A → Z',sort_added:'Recently added',sort_gain:'Gain (high → low)',sort_set:'Set',
 no_movers:'Movers will show up after a few days of price refreshes.',
 add_title:'Add a card',search_ph:'Search for a card',card_lang:'Card language',
 loading_index:'Loading {l} card database…',
 no_results:'No card found.',nr_clear:'Clear filters',f_reset:'Reset filters',qa_title:'Add 1 copy to my collection',qa_added:'“{n}” added to your collection',ah_sets:'Latest sets',ah_cards:'cards',ah_recent:'Recently viewed',ah_clear:'Clear',nr_in:'See {f} {l} cards',type_to_search:'Type a card name, a set or a number (e.g. 199/165).',results:'{n} result(s)',
 lang_fr:'French',lang_en:'English',lang_ja:'Japanese',ja_hint:'Japanese cards: type the English name (e.g. Charizard), the Japanese name (リザードン), the set code or the number.',ja_searching:'Looking up matching cards in this language…',ja_note:'Prices and images for Japanese cards are less complete than for French and English cards.',
 set:'Set',number:'Number',rarity:'Rarity',illustrator:'Illustrator',
 cm_title:'Cardmarket (EUR)',tcp_title:'TCGplayer (USD)',trend:'Trend',low:'Low',avg7:'7-day avg',avg30:'30-day avg',avg1:'1-day avg',
 reverse_holo:'Reverse / Holo',range:'Estimated price range',range_note:'Based on Cardmarket sales averages (1, 7, 30 days) and trend.',
 no_price:'No price available for this card.',tcp_only_lab:'Converted TCGplayer price',tcp_only_msg:'No Cardmarket price yet for this card (common on brand-new sets): this is the US TCGplayer market price, converted to euros, as a guide.',tcp_only_tip:'Converted TCGplayer price: no Cardmarket price yet',price_upd:'Prices from {d}',
 variant:'Version',condition:'Condition',qty:'Quantity',buy_price:'Unit purchase price (€)',buy_date:'Purchase date',notes:'Notes',status:'Status',
 owned:'Owned',wish:'Wanted',add_btn:'Add to my collection',edit:'Edit',chk_short:'Check price',chk_why:'Why?',mg_via:'Cards found under the name “{n}”.',mg_other_langs:'No card with this name in this language: searching the other languages…',mg_via_n:'English names of the cards whose name contains “{q}”: {n}.',mg_via_more:'and {n} more',nr_in_sets:'“{q}” exists in other sets:',clear_search:'Clear search',mg_fallback:'No French printing listed for this search: here are the English cards.',mgv_serial:'Serialized',mgv_borderless:'Borderless',mgv_showcase:'Showcase',mgv_extended:'Extended art',mgv_fullart:'Full art',mgv_etched:'Etched',mgv_prerelease:'Prerelease',mgv_promo:'Promo',scan_mg_name:'Name read: “{q}”',scan_mg_tips:'Tip: frame the bottom of the card well (number, set code and language), flat and well lit.',mg_rar_all:'All rarities',mg_special:'Special versions',mg_special_hint:'Borderless, showcase, extended art, full art, serialized…',v_foil:'Foil',game_all:'All games',game_all_s:'All',game_pick:'Choose the game',n_card1:'{n} card',ev_game:'Game',mg_ph:'Search a Magic card…',mg_hint:'Type the name of a Magic card (English or French), or pick a set.',mg_src:'Data and prices: Scryfall (Cardmarket prices).',mg_none:'No card found. Try the English name, or the other language.',mg_more:'Show more',share:'Share',share_tab_img:'Image',share_tab_link:'Link',share_sel_all:'Whole wishlist (first 8 + “+N”)',share_sel_n:'{n} card(s) chosen',share_pick:'Choose cards',share_pick_d:'Tap cards to add them to or remove them from the image. Above 9, the image shows the first 8 and “+N”.',share_pick_auto:'Automatic choice',share_pick_ok:'Done',share_pick_more:'8 shown + “+N”',share_img_t:'My wishlist',share_img_prio:'= priority',share_img_src:'Average Cardmarket prices',share_img_made:'Made with Gleamvault',share_img_send:'Share the image',share_img_dl:'Image downloaded',share_prev:'See the page as the recipient will',share_prev_ban:'Preview: this is what the person opening your link will see.',share_prev_back:'Back',share_t:'Share my wishlist',share_need_acc:'Share links need a free account: it keeps the page up to date.',share_link_d:'Create a link to a page showing your wishlist, updated whenever it changes. Anyone with the link can see it, no account needed.',share_prices:'Show prices',share_make:'Create the link',share_err:'Couldn’t create the link right now.',share_live:'Your link is live. The page updates by itself when your wishlist changes.',share_send:'Send the link',share_off:'Turn off the link',share_off_q:'Turn off the link? The page won’t be visible anymore. A new (different) link can be created later.',share_unavail:'Link sharing isn’t enabled on the server yet.',share_title:'My Gleamvault wishlist',copy:'Copy',copied:'Link copied',shared_t:'Shared wishlist',shared_gone:'This link doesn’t exist or was turned off.',shared_cta:'Discover Gleamvault',shared_made:'Wishlist made with Gleamvault, the app to track your card collection.',shared_budget:'budget',shared_upd:'updated {d}',chk_pill_l:'to check',chk_pill_tip:'{n} card(s) with a price to check: see the list',chk_tip:'The Cardmarket price looks wrong for this rarity: card left out of the value. Open the card to check.',chk_tcp_tip:'Suspicious Cardmarket price: TCGplayer price used (converted to euros)',chk_alt_lab:'TCGplayer price (converted)',chk_msg:'⚠ Cardmarket shows {v}, an implausible price for a “{r}” card. The price database probably links this card to the wrong product (common on brand-new sets). It is left out of your collection value: check the sales and use your price.',chk_msg_alt:'⚠ Cardmarket shows {v}, an implausible price for a “{r}” card. The app uses the TCGplayer price instead. Check the sales and use your price if needed.',chk_val:'{n} card(s) with a price to check, left out of the total',chk_val_alt:'{n} at TCGplayer price',chk_list:'Prices to check',chk_list_d:'The Cardmarket price of these cards looks wrong for their rarity (often on brand-new sets). Open a card to see its eBay sales and use your price.',chk_excluded:'left out of total',sold_t:'Sold on eBay',sold_d:'What the card actually sold for',sold_see:'See',buy_t:'Available to buy on eBay',buy_d:'Live listings, cheapest first (incl. shipping)',buy_sold:'Sold prices to compare',al_short:'Alert',sold_login:'eBay sign-in required (once)',sold_alt:'No account: 130point',my_q:'Seen a different price?',my_cta:'Use my price',my_label:'My observed price (per copy)',my_src:'Seen on',src_ebay:'eBay sold',src_vinted:'Vinted',src_cm:'Cardmarket',src_shop:'Shop',src_other:'Other',my_use:'Use this price',my_price:'My price',my_price_l:'my price',my_est:'Cardmarket estimate: {v}',my_gap:'gap',my_cal:'Calibrated to the market: {g} vs Cardmarket',my_cal2:'Entered {v} on {d} · Cardmarket today {e}',my_fixed:'Fixed price (no Cardmarket estimate to follow)',my_clear:'Back to the estimate',my_saved:'Your price is calibrated: it will now follow the market',my_cleared:'Back to the Cardmarket estimate',man_tag:'Manual',man_hint:'Is your card brand new and not in the database yet?',man_hint_link:'Add it manually',man_add:'Add a card manually',man_form_d:'For a card too recent to be in the database. It will be linked to the real card automatically once it arrives.',man_name:'Card name',man_set_other:'Other / not in the list yet',man_set_name:'Set name (optional)',man_num:'Number',man_value:'Manual value (optional)',man_value_ph:'Otherwise not counted in the value',man_note:'Without a manual value, the card isn’t counted in your collection value until it’s linked.',man_added:'“{n}” added manually',man_list:'Manual cards',scan_rec_t:'Cards that look like your photo',scan_rec_d:'Tap the right card to open it.',scan_rec_only:'Text unreadable, but here are the cards closest to your photo',scan_rec_hi:'Very close',scan_rec_mid:'Close',scan_rec_lo:'Possible',rl_title:'Refresh log',rl_row_d:'What changed in the value at the last refreshes',rl_d:'Collection value before → after each price refresh, and the cards that moved most, with where their price comes from. Useful to understand a change.',rl_cards:'{n} cards refreshed',rl_failed:'{n} no answer',rl_nomove:'No card changed price.',rl_none:'No refresh recorded yet.',el_title:'Error log',del_acc:'Delete my account',del_acc_d:'Your account, your synced collection and your shared wishlist will be permanently deleted from our servers. Your cards stay on this device (guest mode): export a backup if you want to keep them elsewhere.',del_acc_type:'To confirm, type {w}:',del_acc_word:'DELETE',del_acc_btn:'Delete permanently',del_acc_done:'Account deleted. Your cards stay on this device.',del_acc_missing:'Deletion is not enabled on the server yet. Try again later.',coll_loading:'Loading your collection…',el_row_d:'{n} error(s) recorded on this device',el_row_d1:'1 error recorded on this device',el_d:'The latest errors the app met on this device. If something goes wrong, copy and send them.',el_none:'No error recorded.',el_copy:'Copy',el_copied:'Log copied',el_clear:'Clear',coll_stuck_t:'Collection temporarily unreadable',coll_stuck_d:'Your phone’s storage did not answer. Your collection is safe: close and reopen the app.',coll_stuck_btn:'Reload',coll_stuck_save:'Reload the app before changing your collection.',bk_text:'Your {n} cards are only saved on this device. Keep them safe:',bk_account:'Create a free account',bk_export:'Export',bk_later:'Later',offline_refresh:'No connection: prices will be refreshed when you are back online.',scan_mg_prints:'This artwork exists in several printings: tap yours.',scan_mg_byname:'Search for « {q} » instead',upd_avail:'New version',upd_btn:'Update',upd_force_t:'Update needed',upd_force_d:'This version of Gleamvault is no longer supported. Update it to continue: your collection is kept and syncing will resume afterwards.',upd_force_off:'No connection: the update will happen as soon as you are online.',rl_safe:'Hidden prices mode: only the number of refreshed cards is shown.',rl_s_cm:'Cardmarket',rl_s_tcp:'TCGplayer',rl_s_chk_tcp:'TCGplayer (suspicious price)',rl_s_chk_out:'left out (price to check)',rl_s_my:'my price',rl_s_man:'manual value',rl_s_none:'no price',ni_title:'Cards without a picture',ni_row_d:'Cards whose image can’t be found yet',ni_d:'Images our sources don’t have (common for Japanese and brand-new cards). You can copy the list and report it on the TCGdex Discord so they get added. The list updates as you browse your collection.',ni_copy:'Copy the list',ni_copied:'{n} cards copied',ni_none:'All your displayed cards have a picture.',man_list_d:'Linked automatically to the real card once it reaches the database. After {d} days without a match, the app asks whether to keep them.',man_row_d:'Hand-added cards waiting for the database',man_none:'No manual cards.',man_noset:'Unknown set',man_age:'{n} d ago',man_keep:'Keep',man_link_one:'Link',man_found:'{n} manual card(s) now in the database',man_link_btn:'Link',man_stale:'{n} manual card(s) still not found after {d} days',man_check:'Review',man_linked:'{n} card(s) linked to the database: image and price added',pill_short:'Badge size',pill_d:'Badges and buttons on the cards.',guest:'Guest mode',guest_d:'Your collection is saved on this device only.',have_account:'I already have an account',safe_short:'Hides every price',sec_wishalerts:'Wishlist & alerts',deal_short:'Drop since added to the wishlist',notif_short:'When a price alert fires (app open)',notif_blocked:'Notifications are blocked: allow them in your browser settings.',sec_mydata:'My data',exp_json_d2:'File with your whole collection ({n} cards)',exp_json_d21:'File with your whole collection (1 card)',imp_d2:'Replaces the current collection',data_note2:'Without an account, export a backup now and then, and before changing phone.',sec_help:'Help',tour_again_t:'Replay the tour',ab_line:'Pokémon cards TCGdex · Magic cards Scryfall · Prices Cardmarket & TCGplayer · Images TCGdex, Scrydex & Scryfall · Scan Tesseract.js',deal_rule:'drop ≥ {p} %',deal_cfg:'Good deals',deal_cfg_d:'A wishlist card becomes a good deal when its price drops by this much since you added it.',deal_cfg_n:'A card below your 🔔 alert target is always a good deal.',deal_saved:'Good deals: drop of {p} % or more',ev_value:'My collection value',n_cards:'{n} cards',ev_no_period:'Not enough history for this period.',p_7:'7 d',p_30:'30 d',p_365:'1 y',p_all:'All',pl_7:'7 days',pl_30:'30 days',pl_365:'1 year',pl_all:'the whole period',ev_over:'Over {p}:',ev_best:'My best cards',see_all:'See all',see_less:'See less',ev_moves:'Movements',ev_7d:'7 days',ev_vs_buy:'vs purchase price',ev_up:'Gainers',ev_down:'Losers',ev_gains:'Profits',ev_no_gain:'Add a purchase price to your cards to see your profits.',ev_see_n:'See all {n}',ev_rep:'Breakdown',ev_lang:'Language',rar_none:'No rarity',others:'Others ({n})',ev_deals:'{n} good deal(s)',deals_title:'Good deals ({n})',deal_hit:'below your target',prio:'Priority',prio_on:'“{n}” marked as priority',prio_off:'“{n}” is no longer a priority',since_added:'Change since added to the wishlist (green = price drop)',tour_hi:'Welcome to Gleamvault',tour_hi_d:'Your card collection (Pokémon, Magic…) in your pocket: find your cards, track their value and never miss a deal. Quick 1-minute tour?',tour_go:'Let’s go',tour_skip:'Skip',tour_next:'Next',tour_try:'Try it',tour_coll:'<b>Collection</b>: all your cards with their value. Tap a card to see its sheet and your copies.',tour_add:'<b>Add</b>: search a card by name, set or number, or scan it with the camera.',tour_wish:'<b>Wishlist</b>: the cards you’re after, with their budget, price alerts 🔔 and a button to <b>share</b> it (image or link).',tour_safe:'<b>Safe mode</b>: this shield hides every price in one tap. Handy to show your collection without revealing its value.',tour_pick:'First, pick your <b>game</b> (Pokémon, Magic…) and the <b>language of your cards</b> with the flags: it’s the language printed on the card, you can type its name in any language.',news_t:'What’s new?',news_op:'<b>One Piece is here</b>: add your One Piece cards, each version (parallel, alternate art, manga) with its own price. Pick the game with the small button left of the flags in Add.',news_fx:'<b>Dollar prices converted at the rate of the day</b> from the European Central Bank (One Piece and TCGplayer prices).',news_noimg:'<b>Cards without a picture</b>: find them in Settings → Help, with a list to copy and report them.',news_try_op:'Try One Piece',news_ok:'Got it',tour_value:'<b>Value</b>: how your collection evolves, your most valuable cards and the biggest moves.',tour_set:'<b>Settings</b>: your free account to sync your phone and computer, theme, app language and backups.',tour_trial:'Your turn',tour_search:'Grab a card you have at hand and type its name (or number, e.g. 199/165) in the search bar.',tour_addit:'Find your card and tap <b>＋</b> to add it. You can also tap the card to pick the version and condition.',tour_bravo:'Well done!',tour_bravo_d:'Your first card is in your collection. Create a free account to back it up and get it on your phone and computer.',tour_bravo_u:'Your first card is in your collection and already synced with your account.',tour_acc:'Create a free account',tour_local:'Continue without an account',tour_local_d:'Without an account, your collection stays on this device. You can create one later in Settings without losing anything.',tour_end:'See my collection',al_active:'Alert on',del_one:'Remove 1 copy',deleted_n:'“{n}” removed from your collection',deleted_one:'1 copy of “{n}” removed',range_short:'Range:',est_price:'Estimated price',over_30d:'over 30 days',since_track:'since tracking',price_detail:'Price details',bought:'Bought',on_date:'on {d}',manual_short:'Manual value',manual_tag:'manual',my_copies:'My copies',copies_value:'Value of my copies',add_copy:'Add a copy',added_from_wish:'“{n}” added to your collection and removed from your wishlist',fs_hint:'Tap to zoom · swipe down to close',fs_open:'Enlarge image',buy_notes:'Purchase and notes (optional)',cta_wish:'Wishlist',in_wish:'In my wishlist',add_wish_btn:'Add to wishlist',added:'“{n}” added!',
 v_normal:'Normal',v_reverse:'Reverse',v_holo:'Holo',v_firstEdition:'1st edition',
 c_MT:'Mint',c_NM:'Near Mint',c_EX:'Excellent',c_GD:'Good',c_LP:'Light Played',c_PL:'Played',c_PO:'Poor',
 save:'Save',delete:'Delete',cancel:'Cancel',confirm:'Confirm',close:'Close',saved:'Changes saved',
 unit_value:'Unit value',gain:'Gain',history:'Price history',
 wish_title:'Wishlist',wish_empty:'Your wishlist is empty. In “Add”, tap a card’s heart to add it here.',
 evo_title:'Collection value',see_value:'Details',evo_empty:'The chart will appear after a few days: one point is saved each day the collection or prices change.',value:'Value',
 data_title:'Settings',lang_label:'App language',theme_label:'Theme',theme_dark:'Dark',theme_light:'Light',exp_json_t:'Export a backup',imp_t:'Restore a backup',exp_csv_t:'Export for Excel',exp_csv_d:'Spreadsheet readable in Excel or Google Sheets.',notif_t:'Notifications',reload_t:'Reload card database',reload_d:'If a brand-new set does not show up in search yet.',import_ok:'{n} cards imported',import_ok1:'1 card imported',import_bad:'Invalid file',
 import_confirm:'Replace your current collection ({a} entries) with the backup ({b} entries)?',
 cache_cleared:'Card database reloaded',
 sort_label:'Sort results',ss_relevance:'Sort: relevance',ss_num_desc:'Number high → low (rares first)',ss_num_asc:'Number low → high',ss_newest:'Newest sets first',ss_oldest:'Oldest sets first',secret_only:'Secret cards',secret:'Secret',secret_hint:'Number above the set’s official count (e.g. 199/165) or special gallery: usually the most sought-after rares.',credit_short:'Cardmarket & TCGplayer prices via TCGdex, updated daily',credit_short_mg:'Cardmarket & TCGplayer prices via TCGdex (Pokémon) and Scryfall (Magic), updated daily',credit_op:'One Piece: OPTCG API (TCGplayer prices converted to euros at the ECB rate of the day)',op_ph:'Name or number (OP09-118)',op_hint:'Type a name (e.g. Luffy, Shanks), a nickname (e.g. Whitebeard, Big Mom, Akainu) or a number (e.g. OP09-118, 118). Each version (parallel, alternate art, manga) is a separate card with its own price.',op_src:'Data, pictures and prices: OPTCG API (English edition, TCGplayer prices converted to euros). Official pictures are marked “SAMPLE” by Bandai.',op_none:'No card found. Names are in English: try the English name or the card number.',op_loading:'Loading the One Piece card list…',op_lang_note:'One Piece data comes from the English edition: English picture and price, same card number.',op_special_hint:'Parallels, alternate arts, manga, specials',op_promos:'Promos',opv_par:'Parallel',opv_alt:'Alternate art',opv_manga:'Manga',opv_sp:'Special',ss_price:'Price high → low',tcp_only_msg_op:'US TCGplayer market price for the English edition, converted to euros at the European Central Bank rate of the day. Our sources have no Cardmarket price for One Piece.',scan_op_num:'Number read: {n}',scan_op_tips:'Frame the bottom of the card, where the number is printed (e.g. OP09-118), in good light, or type the number in the search.',about_more:'About',ab_ncards:'{n} cards',ab_ncard1:'{n} card',ab_legal:'Pokémon and all related names, images and trademarks are the property of The Pokémon Company, Nintendo, Creatures and GAME FREAK. Magic: The Gathering is a trademark of Wizards of the Coast. One Piece © Eiichiro Oda / Shueisha, Toei Animation; One Piece Card Game © Bandai. Gleamvault is an unofficial fan project, not affiliated with these companies.',
 price_unavailable:'no price',err_net:'Network error — check your connection.',
 scan_btn:'Scan a card',scan_title:'Reading the card',scan_loading:'Loading the reader (a few seconds the first time)…',scan_reading:'Reading name and number…',
 scan_fail:"I couldn't identify the card.",scan_tips:'Tip: frame the whole card, straight and flat, with good light and no glare. You can also type the number printed at the bottom (e.g. 199/165).',
 scan_found:'Card read: “{q}” ({n} results), pick the right one.',
 scan_retry:'Full-art card? Retrying to read the number…',scan_again:'Take another photo',
 account:'Account',password_plain:'Password',pwd_confirm:'Confirm the password',signup_go:'Create my account',no_account:'No account yet?',have_account:'Already have an account?',err_pwd_match:'The two passwords do not match.',auth_login:'Logging in…',auth_signup:'Creating your account…',err_timeout:'The server is not responding. Check your connection and try again in a moment.',login:'Log in',signup:'Sign up',logout:'Log out',password:'Password (min. 8 characters)',show_pwd:'Show password',hide_pwd:'Hide password',forgot_title:'Forgot password',forgot_why:'Enter your account email: you will receive a link to choose a new password.',forgot_send:'Send the link',back:'Back',err_fields_login:'Enter your email and password.',err_wait:'For security, wait a minute before requesting another email for this address.',err_pwd_len:'The password must be at least 8 characters.',forgot:'Forgot password?',new_pwd:'New password',
 account_why:'Create a free account to get your collection on both your computer and your phone. Without an account, it stays on this device.',
 check_mail:'Account created! Click the link in the email to confirm it, then log in.',reset_sent:'Email sent: follow the link to choose a new password.',
 logged_in:'Logged in! Syncing…',logged_out:'Logged out',sync_first:'Collection synced ({n} entries)',
 logout_q:'Log out from this device?',logout_keep:'Keep a copy on this device',logout_wipe:'Erase from this device',
 sync_now:'Sync now',sync_ok:'synced at {d}',sync_running:'Syncing…',sync_error:'Sync failed (will retry)',sync_off:'Not logged in',
 sb_unavailable:'The account service is unreachable right now (internet connection?).',
 err_login:'Wrong email or password.',err_confirm:'Please confirm your email first (link sent at sign-up).',err_exists:'An account already exists with this email: log in.',
 err_rate:'Email sending limit reached for now: try again a bit later (up to an hour).',err_pwd:'Password rejected',err_fields:'Enter a valid email and a password of at least 8 characters.',err_email:'Enter your email.',
 copies:'{n} copies of this card in your collection',owned_n:'You own {n} copy/copies of this card',quick_wish:'Add to / remove from my wishlist',add_short:'Add',filters:'Filters',priv_hide:'Turn on Safe mode',priv_show:'Turn off Safe mode',priv_on:'Safe mode on 🛡',priv_off:'Safe mode off',priv_t:'Safe mode',safe_banner:'Safe mode: prices hidden',safe_off_short:'Turn off',safe_value:'Safe mode is on: the collection value is hidden.',safe_prices:'Safe mode: prices hidden.',ptr_pull:'Pull to refresh prices',ptr_release:'Release to refresh',ptr_busy:'Refreshing prices…',display:'Display',pill_size:'Size of the badges on cards',pill_s:'Small',pill_m:'Normal',pill_l:'Large',wish_budget:'Budget to complete your wishlist',wish_count:'{n} card(s) to find',wish_remove:'Remove from my wishlist',alert_cfg:'Price alert',al_below:'↓ Below',al_above:'↑ Above',al_on:'Turn on alert',al_off:'Turn off',al_saved:'Price alert saved',al_removed:'Price alert turned off',undo:'Undo',wish_added:'“{n}” added to your wishlist',wish_removed:'“{n}” removed from your wishlist',reprint_short:'Reprint',reprint:'Reprint (original number printed on the card)',
 more_opts:'Grading & manual value (optional)',alert_section:'Price alert (optional)',alert_hint:'Checked on each price refresh. Handy to watch for a drop on your wishlist.',grader:'Grading company',raw:'Raw (ungraded)',grade:'Grade',cert:'Cert number',
 manual_value:'Manual value (€)',auto:'auto (Cardmarket)',alert:'Price alert',alert_none:'None',alert_below:'If price drops below…',alert_above:'If price rises above…',alert_price:'Alert threshold (€)',
 extra_hint:'Cardmarket only prices raw cards: for a graded card, enter a manual value (the eBay link searches sales with the grade).',
 
 alerts_title:'{n} price alert(s) triggered',alert_toast:'{n} price alert(s) triggered!',alert_msg:'{n} is at {v}',clear_alerts:'Clear these alerts',
 notif_off:'notifications unavailable here',
}};

/* ============ state & storage ============ */
const LS = {
  // a value of the wrong shape (damaged or tampered storage) is ignored: the default is used instead
  get(k,d){try{const v=localStorage.getItem(k);if(!v)return d;const x=JSON.parse(v);
    if(Array.isArray(d)&&!Array.isArray(x))return d;if(d&&typeof d==='object'&&!Array.isArray(d)&&(!x||typeof x!=='object'||Array.isArray(x)))return d;
    if(typeof d==='number'&&typeof x!=='number')return d;return x}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){toast('Storage error')}}
};
// settings are only identifiers, numbers and switches: anything else (damaged or tampered storage, old format) is dropped
const SET_ENUM={lang:['fr','en'],cardLang:['fr','en','ja'],theme:['dark','light'],game:['pk','mg','op'],gameView:['all','pk','mg','op'],mgLang:['fr','en']};
const SET_NUM=['dealPct','lastSync','lastRefresh','lastBackup','backupLater'];
const BAD_KEYS=new Set(['__proto__','constructor','prototype']);
function cleanSettings(s){
  const o={};if(!s||typeof s!=='object'||Array.isArray(s))return o;
  for(const [k,v] of Object.entries(s)){
    if(BAD_KEYS.has(k)||!/^\w{1,40}$/.test(k))continue;
    if(SET_ENUM[k]){if(SET_ENUM[k].includes(v))o[k]=v;continue}
    if(SET_NUM.includes(k)){if(typeof v==='number'&&isFinite(v))o[k]=v;continue}
    if(typeof v==='boolean'||(typeof v==='number'&&isFinite(v)))o[k]=v;
    else if(typeof v==='string'){if(/^[\w.-]{0,64}$/.test(v))o[k]=v}
    else if(Array.isArray(v))o[k]=v.filter(x=>typeof x==='string'&&/^[\w-]{1,64}$/.test(x)).slice(0,1000);
    else if(v&&typeof v==='object')o[k]=Object.fromEntries(Object.entries(v).filter(([a,b])=>/^[\w-]{1,40}$/.test(a)&&(typeof b==='boolean'||typeof b==='number'&&isFinite(b))));
  }
  if('dealPct'in o)o.dealPct=Math.min(25,Math.max(5,Math.round(o.dealPct)));
  return o;
}
const settings = Object.assign({lang:'fr',cardLang:'fr',theme:'dark',lastRefresh:0,sort:'value'}, cleanSettings(LS.get('pf_settings',{})));
// Entries can come from a backup file, another device (sync), the local copy or an older version. Identifiers and codes are
// forced to safe values here, so that a crafted file can never inject markup through them (names and free texts are
// escaped wherever they are shown). Applied when the collection is read, restored or merged.
const MY_SRCS=['ebay','vinted','cm','shop','other'];
const safeId=v=>String(v??'').replace(/[<>"'`&\\\s]/g,'').slice(0,120);
// nested values (prices, grade, alert…) from outside: only plain data, finite numbers, short texts, no prototype keys
function cleanDeep(v,depth=0){
  if(typeof v==='number')return isFinite(v)?v:null;
  if(typeof v==='string')return v.slice(0,300);
  if(typeof v==='boolean'||v==null)return v??null;
  if(depth>4)return null;
  if(Array.isArray(v))return v.slice(0,200).map(x=>cleanDeep(x,depth+1)).filter(x=>x!=null);
  if(typeof v==='object'){const o={};for(const k of Object.keys(v).slice(0,200))if(!BAD_KEYS.has(k))o[k]=cleanDeep(v[k],depth+1);return o}
  return null;
}
const money=v=>{v=+v;return isFinite(v)?Math.min(1e7,Math.max(0,v)):0};   // 10 M€ a card is more than any real price
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
function cleanEntry(e){
  if(!obj(e))return null;
  for(const k of BAD_KEYS)if(Object.prototype.hasOwnProperty.call(e,k))delete e[k];
  for(const k of ['price','tcp','grade','alert'])if(e[k]!=null)e[k]=obj(e[k])?cleanDeep(e[k]):null;
  if(e.price){if(e.price.value!=null&&!(typeof e.price.value==='number'&&isFinite(e.price.value)&&e.price.value>=0))delete e.price.value;else if(e.price.value!=null)e.price.value=money(e.price.value)}
  if(e.alert){e.alert.price=money(e.alert.price);if(!['above','below'].includes(e.alert.dir))e.alert=null}
  if(e.manual!=null)e.manual=money(e.manual);
  for(const k of ['date','added','keptSince','keepSince','nameEn'])if(e[k]!=null&&typeof e[k]!=='number')e[k]=String(e[k]).slice(0,k==='nameEn'?300:40);
  if(e.prio!=null)e.prio=!!e.prio;
  if(e.mgTags!=null)e.mgTags=Array.isArray(e.mgTags)?e.mgTags.filter(x=>typeof x==='string').map(x=>x.slice(0,40)).slice(0,12):[];
  e.uid=/^[\w-]{1,64}$/.test(String(e.uid??''))?String(e.uid):uidGen();
  for(const k of ['cardId','setId','localId','variant','cond','image','official'])if(e[k]!=null)e[k]=safeId(e[k]);
  if(!e.cardId)return null;
  e.lang=['fr','en','ja'].includes(e.lang)?e.lang:'en';
  e.status=e.status==='wish'?'wish':'owned';
  e.qty=Math.min(9999,Math.max(1,parseInt(e.qty)||1));
  for(const k of ['name','setName','rarity','notes','artist'])if(e[k]!=null){if(typeof e[k]!=='string')e[k]=String(e[k]);if(e[k].length>(k==='notes'?2000:300))e[k]=e[k].slice(0,k==='notes'?2000:300)}
  e.hist=Array.isArray(e.hist)?e.hist.filter(x=>obj(x)&&typeof x.d==='string'&&typeof x.v==='number'&&isFinite(x.v)).slice(-800).map(x=>({d:x.d.slice(0,10),v:money(x.v)})):[];
  if(obj(e.myPrice)){e.myPrice={v:money(e.myPrice.v),est:money(e.myPrice.est),src:MY_SRCS.includes(e.myPrice.src)?e.myPrice.src:'other',d:String(e.myPrice.d??'').slice(0,10)}}else delete e.myPrice;
  if(e.buy!=null)e.buy=money(e.buy);
  return e;
}
const cleanList=l=>Array.isArray(l)?l.map(cleanEntry).filter(Boolean):[];
function uidGen(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36)}
let collection = cleanList(LS.get('pf_collection',[]));   // quick copy (mirror); the real store is IndexedDB, see « collection storage » below
// value history (graph of the Value tab): one point a day; from a backup or another device, only well-formed points are kept
function cleanSnaps(l){
  if(!Array.isArray(l))return [];
  const out=l.filter(x=>obj(x)&&typeof x.d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.d)).slice(-5000).map(x=>{const num=v=>{v=+v;return isFinite(v)&&v>=0&&v<=1e10?v:0};
    const s={d:x.d,value:num(x.value),cost:num(x.cost),count:Math.min(1e7,Math.max(0,parseInt(x.count)||0))};
    if(obj(x.g)){const g={};for(const [k,v] of Object.entries(x.g))if(['pk','mg','op'].includes(k)&&typeof v==='number'&&isFinite(v))g[k]=Math.min(1e10,Math.max(0,v));s.g=g}
    return s});
  return out.sort((a,b)=>a.d.localeCompare(b.d));
}
let snapshots = cleanSnaps(LS.get('pf_snapshots',[]));
const saveSettings=()=>LS.set('pf_settings',settings);
let deleted = LS.get('pf_deleted',{});
const saveCollection=()=>{persistColl();takeSnapshot();scheduleSync()};
const idx = {fr:null,en:null};       // card index per language
const loading = {fr:null,en:null};
const detailCache = {};

function t(k,vars){if(vars&&+vars.n===1){if(k.endsWith('s')&&I18N.fr[k.slice(0,-1)+'1'])k=k.slice(0,-1)+'1';else if(I18N.fr[k+'1'])k=k+'1'}let s=(I18N[settings.lang]||I18N.fr)[k]??I18N.fr[k]??k;if(vars){for(const[a,b]of Object.entries(vars))s=s.replaceAll('{'+a+'}',b);if(vars.n!=null&&s.includes('(s)')){const n=+vars.n,one=settings.lang==='fr'?n<2:n===1;s=s.replace(/\(s\)/g,one?'':'s')}}return s}   // « 1 carte », « 2 cartes » instead of « carte(s) »
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[-_'’.,:]/g,' ').replace(/\s+/g,' ').trim();
const NF={},nf=(lang,cur)=>NF[lang+cur]||(NF[lang+cur]=new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB',{style:'currency',currency:cur}));
const fmtEur=v=>settings.hidePrices?'':v==null||isNaN(v)?'—':nf(settings.lang,'EUR').format(v);
const fmtUsd=v=>settings.hidePrices?'':v==null||isNaN(v)?'—':new Intl.NumberFormat(settings.lang==='fr'?'fr-FR':'en-US',{style:'currency',currency:'USD'}).format(v);
const fmtPct=v=>settings.hidePrices||v==null||!isFinite(v)?'':(v>=0?'+':'')+v.toFixed(1).replace('.',settings.lang==='fr'?',':'.')+' %';
const fmtDate=d=>d?new Date(d).toLocaleDateString(settings.lang==='fr'?'fr-FR':'en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
const today=()=>new Date().toISOString().slice(0,10);
const img=(u,q='low')=>u?`${u}/${q}.webp`:'';
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);

/* IndexedDB cache for big card index */
const idb = {
  db:null,
  open(){return this.db||(this.db=new Promise((res,rej)=>{const r=indexedDB.open('pokefolio',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))},
  async get(k){try{const db=await this.open();return await new Promise(res=>{const q=db.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)})}catch(e){return null}},
  async set(k,v){try{const db=await this.open();await new Promise(res=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(v,k);tx.oncomplete=res;tx.onerror=res})}catch(e){}},
  // strict versions (errors are reported): used for the collection, where a silent failure is not acceptable
  async getS(k){const db=await this.open();return new Promise((res,rej)=>{const q=db.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})},
  async setS(k,v){const db=await this.open();return new Promise((res,rej)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(v,k);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)})}
};

/* ============ collection storage ============
   The collection lives in IndexedDB (no 5 MB limit; localStorage held ~3 MB for 3 000 cards). A copy stays in localStorage while it is
   small enough (fast first read, safety net if we ever had to go back). 'pf_coll_ls' = {ts,len} of that copy: a copy written by
   someone else (older app version, restored by hand) is detected by its length and wins. Writes are grouped (150 ms) and flushed
   when the app goes to the background. If IndexedDB is unavailable or fails, the app stays on localStorage as before. */
const COLL_MIRROR_MAX=2e6;            // characters (localStorage counts 2 bytes each: ~4 MB)
let collTs=0,collIdb=!!window.indexedDB,collTimer=null,collDirty=false;
function persistColl(now){if(collStuck){toast(t('coll_stuck_save'));return}collDirty=true;clearTimeout(collTimer);if(now)return persistCollNow();collTimer=setTimeout(persistCollNow,150)}
async function persistCollNow(){
  clearTimeout(collTimer);collTimer=null;if(!collDirty)return;collDirty=false;
  const ts=collTs=Math.max(Date.now(),collTs+1),data=collection;let mirror=false;
  try{const str=JSON.stringify(data);if(str.length<=COLL_MIRROR_MAX||!collIdb){localStorage.setItem('pf_collection',str);localStorage.setItem('pf_coll_ls',JSON.stringify({ts,len:str.length}));mirror=true}
      else{localStorage.removeItem('pf_collection');localStorage.removeItem('pf_coll_ls');localStorage.setItem('pf_coll_big','1')}
      if(mirror)localStorage.removeItem('pf_coll_big')}
  catch(e){if(collIdb)try{localStorage.removeItem('pf_collection');localStorage.removeItem('pf_coll_ls')}catch(_){}}   // without IndexedDB, keep the last copy that fit
  if(collIdb){try{await idb.setS('pf_collection',{ts,data});if(localStorage.getItem('pf_coll_idb')!=='1')localStorage.setItem('pf_coll_idb','1');return}catch(e){collIdb=false}}
  if(!mirror)toast('Storage error');
}
addEventListener('pagehide',()=>{if(collDirty)persistCollNow()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&collDirty)persistCollNow()});
async function loadCollStore(){
  if(!collIdb)return;
  try{
    const raw=localStorage.getItem('pf_collection'),meta=LS.get('pf_coll_ls',null);
    const rec=await idb.getS('pf_collection');
    const lsForeign=raw!==null&&(!meta||meta.len!==raw.length);          // written by an older version / by hand
    const lsNewer=raw!==null&&meta&&rec&&meta.ts>rec.ts;                   // IndexedDB write did not finish last time
    if(collTimedOut)return;   // too late: the session already runs on the local copy
    if(rec&&Array.isArray(rec.data)&&!lsForeign&&!lsNewer){if(rec.ts!==meta?.ts||raw===null)collection=cleanList(rec.data);collTs=rec.ts;localStorage.setItem('pf_coll_idb','1');return}
    if(raw===null&&!rec)return;                                            // nothing stored yet
    // first launch with IndexedDB (or the copy is newer): move the localStorage copy over, then read it back to check it
    const ts=collTs=Math.max(Date.now(),(rec?.ts||0)+1);
    await idb.setS('pf_collection',{ts,data:collection});
    const back=await idb.getS('pf_collection');
    if(!back||JSON.stringify(back.data)!==raw&&JSON.stringify(back.data)!==JSON.stringify(collection))throw new Error('verify');
    localStorage.setItem('pf_coll_ls',JSON.stringify({ts,len:(raw||'').length}));localStorage.setItem('pf_coll_idb','1');
    try{navigator.storage?.persist?.()}catch(_){}
  }catch(e){collIdb=false}
}
// The tabs are drawn at once and the pages show « loading » until the collection is read (a few ms; up to seconds for a huge
// collection on a slow phone). Some phones occasionally never answer an IndexedDB request: after 8 s the app goes on with
// the localStorage copy (written at every save) and ignores a late answer for this session. Without that copy, if the
// collection is known to live in IndexedDB, it is not shown as empty: a message asks to reopen the app and nothing is
// saved, so no data can be overwritten.
let collTimedOut=false,collStuck=false,collSettled=false;
const COLL_WAIT=8000;
const collReady=Promise.race([loadCollStore().finally(()=>{collSettled=true}),new Promise(r=>setTimeout(()=>{if(!collSettled){collTimedOut=true;collIdb=false;
  if(localStorage.getItem('pf_collection')===null&&(localStorage.getItem('pf_coll_big')==='1'||localStorage.getItem('pf_coll_idb')==='1')){collStuck=true;collection=[]}
  logErr('IndexedDB did not answer within '+COLL_WAIT/1000+' s'+(collStuck?' (no local copy: read-only)':' (local copy used)'),'collReady')}r()},COLL_WAIT))]);
// « already seen » flags (tour, news): also kept in IndexedDB, because a reload soon after showing them could read an older
// localStorage (the browser writes it to disk later) and show them twice. The highest value wins.
const SEEN_FLAGS=['pf_tour','pf_news'];
const flagSet=(k,v)=>{LS.set(k,v);idb.set('flag_'+k,v)};
const flagsReady=collIdb?Promise.race([Promise.all(SEEN_FLAGS.map(async k=>{const v=await idb.get('flag_'+k);if(v!=null&&(+LS.get(k,0)||0)<+v)LS.set(k,v)})).catch(()=>{}),new Promise(r=>setTimeout(r,2500))]):Promise.resolve();

async function getJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(r.status);return r.json()}

/* Japanese sets are shown with a French name: the French equivalent of the main international release when there is a clear one,
   otherwise « Extension japonaise », always followed by the Japanese set code (e.g. « 151 · SV2a »). */
const JA_SET_FR={SV1S:'Écarlate et Violet',SV1V:'Écarlate et Violet',SV2P:'Évolutions à Paldea',SV2D:'Évolutions à Paldea',SV3:'Flammes Obsidiennes',SV2A:'151',
  SV4K:'Faille Paradoxe',SV4M:'Faille Paradoxe',SV4A:'Destinées de Paldea',SV5K:'Forces Temporelles',SV5M:'Forces Temporelles',SV6:'Mascarade Crépusculaire',
  SV6A:'Fable Nébuleuse',SV7:'Couronne Stellaire',SV8:'Étincelles Déferlantes',SV8A:'Évolutions Prismatiques',SV9:'Aventures Ensemble',SV10:'Rivalités Destinées',
  SV11B:'Foudre Noire',SV11W:'Flamme Blanche',M1L:'Méga-Évolution',M1S:'Méga-Évolution'};
function setLabel(lang,id,name){
  if(lang!=='ja')return name;
  const fr=JA_SET_FR[String(id||'').toUpperCase()];
  // no clear French equivalent: the set's own (Japanese) name, more telling than a generic label repeated on every tile
  const own=/-P$/i.test(id)?'Promos':(name&&name!==id?name:'');
  return `${fr||own||(settings.lang==='en'?'Japanese set':'Extension japonaise')} · ${id}`;
}
// Japanese sets: the source's list is not in release order. Main sets follow their code (era, number, « a » = the subset that
// comes after): SM < S < SV < M. Promos, decks and special codes have no place in the chronology: kept after, in the source's order.
const JA_ERA={SM:1,S:2,SV:3,M:4};
function jaOrder(id,i){
  const m=/^(SV|SM|S|M)(\d+)([a-zA-Z]?)$/.exec(String(id||''));
  if(!m)return -100000+i;
  return JA_ERA[m[1]]*10000+(+m[2])*10+(/^a$/i.test(m[3])?5:0);
}
const idxSig=sets=>sets.length+':'+sets.reduce((a,x)=>a+(+x.cardCount?.total||0),0);
async function loadIndex(lang,force){
  if(idx[lang]&&!force)return idx[lang];
  if(loading[lang]&&!force)return loading[lang];
  loading[lang]=(async()=>{
    const cached=!force&&await idb.get('index_'+lang);
    if(cached&&cached.v===INDEX_VER&&Date.now()-cached.ts<INDEX_TTL){applySetNames(lang,cached);idx[lang]=cached;return cached}
    // mobile data: after a day, the small list of sets says whether anything was added (number of sets and of cards);
    // unchanged → the card list kept on the device is still good (the whole list, ~2 MB, is fetched again at most weekly)
    if(cached&&cached.v===INDEX_VER&&cached.sig&&Date.now()-(cached.full||cached.ts)<INDEX_MAX_AGE){
      try{const sets=await getJSON(`${API}/${lang}/sets`);if(idxSig(sets)===cached.sig){cached.ts=Date.now();idb.set('index_'+lang,cached);applySetNames(lang,cached);idx[lang]=cached;return cached}}catch(_){}
    }
    try{
      const [cards,sets,pocket,frSets]=await Promise.all([getJSON(`${API}/${lang}/cards`),getJSON(`${API}/${lang}/sets`),getJSON(`${API}/${lang}/series/tcgp`).catch(()=>({sets:[]})),lang==='en'?getJSON(`${API}/fr/sets`).catch(()=>[]):Promise.resolve([])]);
      const frName={};(frSets||[]).forEach(x=>{frName[x.id]=x.name});
      const excl=new Set((pocket.sets||[]).map(s=>s.id));
      const setMap={};sets.forEach((s,i)=>{if(!excl.has(s.id))setMap[s.id]={id:s.id,src:s.name,fr:frName[s.id],o:i,off:s.cardCount?.official,tot:s.cardCount?.total,sym:s.symbol||'',logo:s.logo||''}});
      const list=[];
      for(const c of cards){
        const sid=c.id.slice(0,c.id.length-String(c.localId).length-1);
        if(excl.has(sid)||!setMap[sid])continue;
        list.push({id:c.id,n:c.name,l:String(c.localId),s:sid,i:c.image||''});
      }
      const data={v:INDEX_VER,ts:Date.now(),full:Date.now(),sig:idxSig(sets),cards:list,sets:setMap};
      await idb.set('index_'+lang,data);applySetNames(lang,data);idx[lang]=data;return data;
    }catch(e){if(cached&&cached.v===INDEX_VER){applySetNames(lang,cached);idx[lang]=cached;return cached}loading[lang]=null;throw e}
  })();
  return loading[lang];
}
// Display names of sets: French for English and Japanese cards when the app is in French (the original name stays searchable)
function applySetNames(lang,data){
  // number of cards of a set when the source gives no count (promos): counted in the index
  const cnt={};for(const c of data.cards)cnt[c.s]=(cnt[c.s]||0)+1;
  for(const st of Object.values(data.sets)){
    if(st.oi==null)st.oi=st.o;
    if(lang==='ja')st.o=jaOrder(st.id,st.oi);
    st.cnt=cnt[st.id]||0;
    st.n=lang==='ja'?setLabel(lang,st.id,st.src):(lang==='en'&&settings.lang==='fr'&&st.fr)?st.fr:st.src;
    st.alt=st.n===st.src?'':st.src;
  }
  for(const c of data.cards)c.h=undefined;
}
const setNameFor=(lang,set)=>idx[lang]?.sets[set?.id]?.n||(lang==='ja'?setLabel(lang,set?.id,set?.name):set?.name)||'';
const SCRY='https://api.scryfall.com';
// Scryfall rate limits: /cards/search, /named, /random = 2 per second (500 ms); everything else 10 per second.
// Every Scryfall call goes through this queue, which spaces calls out and retries politely on 429 (Too Many Requests).
const scryLane={slow:{last:0,chain:Promise.resolve()},fast:{last:0,chain:Promise.resolve()}};   // two lanes: a price refresh never delays a search
function scryFetch(url,stale){
  const slow=/\/cards\/(search|named|random)/.test(url),L=scryLane[slow?'slow':'fast'];
  const run=async()=>{
    for(let i=0;;i++){
      if(stale&&stale())throw new Error('stale');   // superseded search still waiting in line: skip it
      const wait=L.last+(slow?550:110)-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
      if(stale&&stale())throw new Error('stale');
      L.last=Date.now();
      const r=await fetch(url,{headers:{Accept:'application/json;q=0.9,*/*;q=0.8'}});
      if(r.status!==429||i>=2)return r;
      await new Promise(res=>setTimeout(res,(+r.headers.get('Retry-After')||1)*1000*(i+1)));
    }
  };
  const p=L.chain.then(run,run);L.chain=p.catch(()=>{});return p;
}
async function scryJSON(url){const r=await scryFetch(url);if(!r.ok)throw new Error(r.status);return r.json()}
const MG_SET_FR={fdn:'Fondations',dsk:'Duskmourn : la Maison de l’horreur',blb:'Bloomburrow',otj:'Les hors-la-loi de Croisetonnerre',mkm:'Meurtres au manoir Karlov',lci:'Les cavernes oubliées d’Ixalan',
  woe:'Les terres sauvages d’Eldraine',ltr:'Le Seigneur des Anneaux : chroniques de la Terre du Milieu',mom:'L’invasion des machines',one:'Tous phyrexians',bro:'La guerre fratricide',dmu:'Dominaria uni',
  snc:'Les rues de la Nouvelle-Capenna',neo:'Kamigawa : la dynastie néon',vow:'Innistrad : noce écarlate',mid:'Innistrad : chasse de minuit',stx:'Strixhaven : l’académie des mages',khm:'Kaldheim',
  znr:'La renaissance de Zendikar',m21:'Édition de base 2021',iko:'Ikoria : la terre des béhémoths',thb:'Theros par-delà la mort',eld:'Le trône d’Eldraine',m20:'Édition de base 2020',
  war:'La guerre des Étincelles',rna:'L’allégeance de Ravnica',grn:'Les guildes de Ravnica',m19:'Édition de base 2019',dom:'Dominaria',rix:'Les combattants d’Ixalan',xln:'Ixalan'};
function mgTags(c){
  const fe=c.frame_effects||[],pt=c.promo_types||[],T=[];
  if(pt.includes('serialized'))T.push('serial');
  if(c.border_color==='borderless')T.push('borderless');
  if(fe.includes('showcase'))T.push('showcase');
  if(fe.includes('extendedart'))T.push('extended');
  if(c.full_art&&!/basic/i.test(c.type_line||''))T.push('fullart');
  if(fe.includes('etched')||(c.finishes||[]).length===1&&c.finishes[0]==='etched')T.push('etched');
  if(pt.includes('prerelease'))T.push('prerelease');else if(pt.includes('promopack')||pt.includes('stamped')||c.promo)T.push('promo');
  return T.map(k=>t('mgv_'+k));
}
const mgSetName=(code,en)=>settings.lang==='fr'&&MG_SET_FR[code]||en;
const mgImg=(c,size)=>c.image_uris?.[size]||c.card_faces?.[0]?.image_uris?.[size]||'';
const MG_RAR={common:['Commune','Common'],uncommon:['Peu commune','Uncommon'],rare:['Rare','Rare'],mythic:['Mythique','Mythic rare'],special:['Spéciale','Special'],bonus:['Bonus','Bonus']};
function mgToDetail(c,pc){
  const p=pc.prices||{},f=c.finishes||[];
  const hasN=f.length?f.includes('nonfoil'):c.nonfoil!==false,hasF=f.length?(f.includes('foil')||f.includes('etched')):!!c.foil;
  const eur=+p.eur||null,eurF=+p.eur_foil||+p.eur_etched||null;
  return{id:'mg:'+c.id,localId:c.collector_number,name:c.printed_name||c.card_faces?.[0]?.printed_name||c.name,nameEn:c.name,image:mgImg(c,'normal'),
    rarity:(MG_RAR[c.rarity]||[c.rarity,c.rarity])[settings.lang==='fr'?0:1]+mgTags(c).map(x=>' · '+x).join(''),illustrator:c.artist||'',
    set:{id:c.set,name:mgSetName(c.set,c.set_name),cardCount:{official:null}},variants:{normal:hasN,foil:hasF},
    pricing:{cardmarket:{trend:hasN?eur:eurF,'trend-holo':eurF,updated:new Date().toISOString()},
      tcgplayer:{normal:+p.usd?{marketPrice:+p.usd}:null,holofoil:+(p.usd_foil||p.usd_etched)?{marketPrice:+(p.usd_foil||p.usd_etched)}:null}},
    mgcm:pc.purchase_uris?.cardmarket||c.purchase_uris?.cardmarket||''};
}
// Scryfall only prices the English printing: a French card takes the price of the same printing in English (same Cardmarket product)
async function mgDetail(lang,id){
  const c=await scryJSON(`${SCRY}/cards/${encodeURIComponent(id.slice(3))}`);
  let pc=c;
  if(!(+c.prices?.eur>0||+c.prices?.eur_foil>0)&&c.lang!=='en'){try{pc=await scryJSON(`${SCRY}/cards/${encodeURIComponent(c.set)}/${encodeURIComponent(c.collector_number)}`)}catch(err){if(err.message!=='404')throw err}}   // a network hiccup must not look like « no price »
  return mgToDetail(c,pc);
}
async function getDetail(lang,id){
  const k=lang+':'+id;
  if(detailCache[k])return detailCache[k];
  if(id.startsWith('mg:')){const d=await mgDetail(lang,id);detailCache[k]=d;return d}
  if(id.startsWith('op:')){const d=await opDetail(id);detailCache[k]=d;return d}
  if(detailCache[k])return detailCache[k];
  const d=await getJSON(`${API}/${lang}/cards/${encodeURIComponent(id)}`);
  detailCache[k]=d;return d;
}

/* ============ pricing ============ */
function pickPrice(pricing,variant,hasNormal){
  const cm=pricing?.cardmarket;
  if(!cm)return null;
  const useHolo=(variant==='reverse'||((variant==='holo'||variant==='foil')&&hasNormal))&&(cm['trend-holo']>0||cm['avg7-holo']>0);
  const f=k=>{const v=cm[useHolo?k+'-holo':k];return v==null||v===0?null:v};
  const p={trend:f('trend'),low:f('low'),avg1:f('avg1'),avg7:f('avg7'),avg30:f('avg30'),updated:cm.updated};
  // robust estimate: median of trend + sales averages (Cardmarket's trend alone can be erratic on cheap/reverse cards)
  const vals=[p.trend,p.avg1,p.avg7,p.avg30].filter(v=>v>0).sort((a,b)=>a-b);
  p.value=vals.length?(vals.length%2?vals[(vals.length-1)/2]:(vals[vals.length/2-1]+vals[vals.length/2])/2):p.low;
  if(p.value!=null)p.value=Math.round(p.value*100)/100;
  return p.value==null?null:p;
}
function priceRange(p){
  if(!p)return null;
  const vals=[p.avg1,p.avg7,p.avg30,p.trend].filter(v=>v>0);
  if(!vals.length)return null;
  return {min:Math.min(...vals),max:Math.max(...vals)};
}
// value: manual value (graded) > price the user saw (myPrice) > Cardmarket estimate.
// myPrice is "calibrated": it keeps the user's gap to Cardmarket (v/est) and follows the market from there; fixed only when there is no estimate.
const myValue=(mp,est)=>mp.est>0&&est>0?Math.round(est*mp.v/mp.est*100)/100:mp.v;
// suspicious-price detector: TCGdex sometimes maps a card to the wrong Cardmarket product (often on brand-new sets),
// e.g. a Special Illustration Rare at 0.43 €. Checks: a floor by rarity, and a cross-check with TCGplayer (USD).
let USD_EUR=(r=>r>0.3&&r<3?r:0.9)(+(LS.get('pf_fx',{}).r));   // dollar → euro, ECB rate of the day (Frankfurter), last known rate kept offline
async function refreshFx(){const fx=LS.get('pf_fx',{});if(fx.ts&&Date.now()-fx.ts<20*3600e3)return;
  try{const j=await (await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR')).json();const r=+j?.rates?.EUR;if(r>0.3&&r<3){const ch=Math.abs(r-USD_EUR)>0.0005;USD_EUR=r;LS.set('pf_fx',{r,d:j.date,ts:Date.now()});if(ch&&typeof render==='function'&&!document.getElementById('ov'))render()}}catch(_){}}
const RAR_FLOORS=[[/special|spéciale|hyper|gold|dorée|mega.?hyper|ace spec/i,3],[/illustration|ultra|secret|shiny|chromatique|full ?art|rainbow|arc-en-ciel/i,0.8]];
function rarityFloor(r){for(const[re,f]of RAR_FLOORS)if(re.test(r||''))return f;return 0}
function tcpMarket(tcp,variant){
  if(!tcp)return null;
  const order={holo:['holofoil','holo'],foil:['holofoil','foil'],reverse:['reverse-holofoil','reverseHolofoil','reverse'],normal:['normal']}[variant]||['normal'];
  const pick=k=>{const v=tcp[k];return v&&typeof v==='object'?(v.marketPrice||v.midPrice||null):null};
  for(const k of order){const v=pick(k);if(v)return v}
  for(const k of Object.keys(tcp)){const v=pick(k);if(v)return v}
  return null;
}
function openSuspectList(){
  const list=priceSuspects();
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">⚠ ${t('chk_list')}</h2><p class="muted small" style="margin:0 0 10px">${t('chk_list_d')}</p>
    ${list.map(e=>{const c=priceCheck(e);return `<button class="chk-row" data-open="${e.uid}"><span class="ev-th">${imgTag(e.image,e.setId,e.localId,'','low','',e.lang)}</span><span class="t"><b>${esc(e.name)}</b><span>${esc(e.setName)} · ${esc(numLabel(e.localId,e.official))} · ${esc(e.rarity||'')}</span></span><span class="r">${c.alt?`${fmtEur(c.alt)}<small>TCGplayer</small>`:`<s>${fmtEur(c.cm)}</s><small>${t('chk_excluded')}</small>`}</span></button>`}).join('')}</div>`,'sm');
  m.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{closeModal();setTimeout(()=>openEntry(b.dataset.open),50)});
}
function priceCheck(e){
  const cm=e.price?.value;if(!(cm>0))return null;
  const floor=gameOf(e)==='mg'?(new RegExp(t('mgv_serial'),'i').test(e.rarity||'')||/numérotée|serialized/i.test(e.rarity||'')?20:0):rarityFloor(e.rarity),usd=tcpMarket(e.tcp,e.variant),tp=usd?Math.round(usd*USD_EUR*100)/100:null;
  const low=floor&&cm<floor, far=tp&&tp>=2&&cm<tp/5;
  if(!low&&!far)return null;
  // TCGplayer is used instead only when it is itself plausible for the rarity
  return {cm,floor,alt:tp&&tp>=Math.max(floor,cm*5,1)?tp:null};
}
// no Cardmarket price at all (very recent cards, often Magic): TCGplayer converted to euros, shown with a « TCGP » badge
// where a card's value comes from (for the refresh journal)
const valSrc=e=>e.manual>0?'man':e.myPrice?.v>0?'my':priceCheck(e)?(priceCheck(e).alt?'chk_tcp':'chk_out'):e.price?.value>0?'cm':tcpOnly(e)?'tcp':'none';
const tcpOnly=e=>{if(e.price?.value>0)return null;const u=tcpMarket(e.tcp,e.variant);return u>0?Math.round(u*USD_EUR*100)/100:null};
const entryValue=e=>{
  if(e.manual>0)return e.manual;
  if(e.myPrice?.v>0)return myValue(e.myPrice,e.price?.value);
  const chk=priceCheck(e);if(chk)return chk.alt;   // suspicious Cardmarket price: TCGplayer if plausible, otherwise left out of totals
  return e.price?.value??tcpOnly(e);
};
const priceSuspects=(list=collection.filter(e=>e.status!=='wish'))=>list.filter(e=>!(e.manual>0)&&!(e.myPrice?.v>0)&&priceCheck(e));

/* ============ grading & alerts ============ */
const GRADERS=['PSA','CGC','BGS','CCC','PCA','Collect Aura'];
const GRADES=['10','9.5','9','8.5','8','7.5','7','6','5','4','3','2','1'];
function extraFields(e={}){
  const g=e.grade||{},a=e.alert||{};
  return `<details class="full extra" ${g.co||e.manual?'open':''}><summary>🏅 ${t('more_opts')}</summary><div class="form" style="margin-top:4px">
    <label>${t('grader')}<select name="gco"><option value="">${t('raw')}</option>${GRADERS.map(x=>`<option ${g.co===x?'selected':''}>${x}</option>`).join('')}</select></label>
    <label>${t('grade')}<select name="gg">${GRADES.map(x=>`<option ${(g.g||'10')===x?'selected':''}>${x}</option>`).join('')}</select></label>
    <label>${t('cert')}<input maxlength="40" type="text" name="gcert" value="${esc(g.cert||'')}"></label>
    <label>${t('manual_value')}<input max="10000000" type="number" name="manual" min="0" step="0.01" value="${e.manual||''}" placeholder="${t('auto')}"></label>
    <p class="full small muted" style="margin:0">${t('extra_hint')}</p>
  </div></details>
  <details class="full extra" ${a.dir?'open':''}><summary>🔔 ${t('alert_section')}</summary><div class="form" style="margin-top:4px">
    <label>${t('alert')}<select name="adir"><option value="">${t('alert_none')}</option><option value="below" ${a.dir==='below'?'selected':''}>${t('alert_below')}</option><option value="above" ${a.dir==='above'?'selected':''}>${t('alert_above')}</option></select></label>
    <label>${t('alert_price')}<input max="10000000" type="number" name="aprice" min="0" step="0.01" value="${a.price||''}"></label>
    <p class="full small muted" style="margin:0">${t('alert_hint')}</p>
  </div></details>`;
}
function readExtra(f,prev){
  const num=v=>parseFloat(String(v).replace(',','.'))||0;
  const co=f.gco.value,ap=num(f.aprice.value),dir=f.adir.value;
  const keepHit=prev?.alert&&prev.alert.dir===dir&&prev.alert.price===ap?prev.alert.hit:null;
  return{grade:co?{co,g:f.gg.value,cert:f.gcert.value.trim()}:null,manual:num(f.manual.value),alert:dir&&ap?{dir,price:ap,hit:keepHit}:null};
}
function checkAlerts(notify){
  const hits=[];
  for(const e of collection){
    if(!e.alert)continue;const v=entryValue(e);if(v==null)continue;
    const ok=e.alert.dir==='below'?v<=e.alert.price:v>=e.alert.price;
    if(ok){if(!e.alert.hit){e.alert.hit=Date.now();hits.push(e)}}else e.alert.hit=null;
  }
  persistColl();
  if(hits.length&&notify){
    toast('🔔 '+t('alert_toast',{n:hits.length}));
    try{if('Notification' in window&&Notification.permission==='granted'&&settings.notif!==false)hits.forEach(e=>new Notification('Gleamvault',{body:t('alert_msg',{n:e.name,v:fmtEur(entryValue(e))})}))}catch(_){}
  }
  return hits;
}
function alertsBanner(statusFilter){
  const list=collection.filter(e=>e.alert?.hit&&statusFilter(e));
  if(!list.length)return '';
  return `<div class="notice alerts"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>🔔 ${t('alerts_title',{n:list.length})}</b><button class="btn" data-clear-alerts>${t('clear_alerts')}</button></div>
    ${list.map(e=>`<div class="li" data-open="${e.uid}" style="cursor:pointer;padding:6px 0">${esc(e.name)} <span class="muted small">(${esc(e.setName)})</span> — <b>${fmtEur(entryValue(e))}</b> <span class="muted small">${e.alert.dir==='below'?'≤':'≥'} ${fmtEur(e.alert.price)}</span></div>`).join('')}</div>`;
}
function bindAlerts(m,statusFilter){
  const b=m.querySelector('[data-clear-alerts]');
  if(b)b.onclick=()=>{collection.forEach(e=>{if(e.alert?.hit&&statusFilter(e)){e.alert=null;e.upd=Date.now()}});saveCollection();render()};
}

/* ============ snapshots ============ */
function totals(list=collection.filter(e=>e.status!=='wish')){
  let value=0,count=0,cost=0,costBase=0,valueWithCost=0,withCost=0;
  for(const e of list){
    const v=entryValue(e)||0;value+=v*e.qty;count+=e.qty;
    if(e.buy>0){cost+=e.buy*e.qty;valueWithCost+=v*e.qty;withCost++}
  }
  return{value,count,cost,gain:valueWithCost-cost,gainPct:cost?((valueWithCost-cost)/cost*100):null,withCost,unique:list.length};
}
function takeSnapshot(){
  const tt=totals();const d=today();
  const s={d,value:+tt.value.toFixed(2),cost:+tt.cost.toFixed(2),count:tt.count};
  if(gamesUsed().size>1){const g={};for(const e of collection.filter(x=>x.status!=='wish')){const k=gameOf(e);g[k]=(g[k]||0)+(entryValue(e)||0)*(e.qty||1)}for(const k in g)g[k]=+g[k].toFixed(2);s.g=g}
  const i=snapshots.findIndex(x=>x.d===d);
  if(i>=0)snapshots[i]=s;else snapshots.push(s);
  snapshots.sort((a,b)=>a.d.localeCompare(b.d));
  LS.set('pf_snapshots',snapshots);
}
function pushHistory(e){
  if(e.price?.value==null)return;
  e.hist=e.hist||[];const d=today();
  const i=e.hist.findIndex(h=>h.d===d);
  if(i>=0)e.hist[i].v=e.price.value;else e.hist.push({d,v:e.price.value});
  if(e.hist.length>400)e.hist=e.hist.slice(-400);
}
function change7(e){
  if(!e.hist||e.hist.length<2||e.price?.value==null)return null;
  const target=Date.now()-7*864e5;let ref=null;
  for(const h of e.hist){if(new Date(h.d).getTime()<=target)ref=h}
  if(!ref)ref=e.hist[0];
  if(ref.d===today()||!ref.v)return null;
  return (e.price.value-ref.v)/ref.v*100;
}

let refreshing=false;
async function refreshPrices(silent){
  if(refreshing||!collection.length)return;
  if(navigator.onLine===false){if(!silent)toast(t('offline_refresh'));return}
  refreshing=true;
  await Promise.all([...new Set(collection.filter(e=>gameOf(e)==='pk').map(e=>e.lang))].map(l=>loadIndex(l).catch(()=>{})));syncEntrySetNames();
  if(collection.some(e=>gameOf(e)==='op'))await loadOpIndex(!opIdx||Date.now()-(opIdx.ts||0)>12*3600e3).catch(()=>{});   // whole list (~3 MB): at most twice a day
  const keys=[...new Set(collection.filter(e=>!e.manualCard).map(e=>e.lang+':'+e.cardId))];
  let done=0;const btn=document.getElementById('refreshBtn');
  const upd=()=>{if(btn){btn.disabled=true;btn.innerHTML=`<span class="spin"></span> ${t('refreshing',{p:done,t:keys.length})}`}};
  upd();
  const owned=()=>collection.filter(e=>e.status!=='wish');
  const before=new Map(owned().map(e=>[e.uid,[entryValue(e),valSrc(e)]])),total0=totals(owned()).value;
  const queue=[...keys];let failed=0;
  async function worker(){
    while(queue.length){
      const k=queue.shift();const[lang,...rest]=k.split(':');const id=rest.join(':');
      try{
        delete detailCache[k];
        const d=await getDetail(lang,id);
        for(const e of collection.filter(x=>x.lang===lang&&x.cardId===id)){
          const p=pickPrice(d.pricing,e.variant,d.variants?.normal),tcp=d.pricing?.tcgplayer||null,tcpOk=!!tcp&&Object.values(tcp).some(v=>v);
          // a source that answers without a price this time keeps the last known one (up to 14 days), so totals don't jump back and forth
          // never step back: a copy of the data older than the one already stored (a lagging server) is ignored
          const older=p&&p.updated&&e.price?.updated&&String(p.updated)<String(e.price.updated);
          if(older){}else if(p){e.price=p;delete e.keptSince}else if(e.price?.value>0&&Date.now()-(e.keptSince||(e.keptSince=Date.now()))<14*864e5){}else{e.price=p;delete e.keptSince}
          const tOlder=tcpOk&&tcp.updated&&e.tcp?.updated&&String(tcp.updated)<String(e.tcp.updated);
          if((tcpOk&&!tOlder)||!e.tcp)e.tcp=tcp;
          pushHistory(e);
          if(id.startsWith('mg:')||id.startsWith('op:')){e.setName=d.set.name;e.rarity=d.rarity;if(id.startsWith('op:'))e.name=d.name} // Magic / One Piece: set name and rarity (and One Piece names) follow the source
        }
      }catch(err){failed++}
      done++;upd();
    }
  }
  await Promise.all(Array.from({length:6},worker));
  settings.lastRefresh=Date.now();saveSettings();saveCollection();
  try{const moves=owned().map(e=>{const[a,sa]=before.get(e.uid)||[null,''],b=entryValue(e);return{n:e.name,s:(e.setName||'')+' · '+(e.localId||''),a,b,sa,sb:valSrc(e),d:((b||0)-(a||0))*(e.qty||1)}}).filter(x=>Math.abs(x.d)>=0.01).sort((x,y)=>Math.abs(y.d)-Math.abs(x.d)).slice(0,8);
    const log=LS.get('pf_rlog',[]);log.unshift({ts:Date.now(),a:total0,b:totals(owned()).value,n:keys.length,f:failed,m:moves});LS.set('pf_rlog',log.slice(0,10))}catch(_){}
  refreshing=false;
  const hits=checkAlerts(false);
  if(hits.length){toast('🔔 '+t('alert_toast',{n:hits.length}));try{if('Notification' in window&&Notification.permission==='granted'&&settings.notif!==false)hits.forEach(e=>new Notification('Gleamvault',{body:t('alert_msg',{n:e.name,v:fmtEur(entryValue(e))})}))}catch(_){}}
  else if(!silent||failed)toast(failed?t('err_net'):t('saved'));
  render();
}

/* ============ UI helpers ============ */
function toast(msg,action){
  document.querySelectorAll('.toast').forEach(x=>x.remove());
  const d=document.createElement('div');d.className='toast';d.textContent=msg;
  if(action){const b=document.createElement('button');b.className='toast-act';b.textContent=action.label;b.onclick=()=>{d.remove();action.fn()};d.appendChild(b)}
  document.body.appendChild(d);setTimeout(()=>d.remove(),action?5000:2600);
}
// Modals get their own history entry so the phone's back button / back gesture closes them
let modalHist=false,fwdDone=false,ignorePop=false,backPending=null,backInFlight=false,pushWanted=false;
// closing a modal and opening another one right away (scan → card sheet…) reuses the same history entry, and a « back » still
// in flight is awaited before pushing a new one — otherwise the next close went one step too far (back to another tab, or out of the app)
function histPush(){if(backInFlight){pushWanted=true;return}try{history.pushState({gvModal:1},'',location.href);modalHist=true}catch(_){}}
function closeModal(fromPop){
  document.querySelector('.imgfs')?.remove();
  const root=document.getElementById('modalRoot');const had=!!root.innerHTML;
  root.innerHTML='';document.body.style.overflow='';
  // keyboard users get their place back (not on touch screens: focusing could pop the keyboard up)
  if(had&&modalOpener&&modalOpener.isConnected&&/^(BUTTON|A)$/.test(modalOpener.tagName)&&matchMedia('(pointer:fine)').matches)try{modalOpener.focus({preventScroll:true})}catch(_){}
  if(had)modalOpener=null;
  if(modalHist&&fromPop!==true){modalHist=false;if(had&&!backPending)backPending=setTimeout(()=>{backPending=null;ignorePop=true;backInFlight=true;backHash=location.hash;fwdDone=false;history.back()},0)}
  else if(fromPop===true)modalHist=false;
}
// Our own history.back() (modal closed by ✕ or code) must not be confused with a tab switch made at the same moment:
// - a hash change fires its own popstate with another hash than the one we are returning to → not ours: remember it, keep waiting,
//   and go there once our back has landed (Chrome may drop that entry when the back completes);
// - landing on a modal entry means that tab switch was pushed after it → step forward once so the switch wins.
// A modal entry left over from a reload is neutralised at start.
try{if(history.state&&history.state.gvModal)history.replaceState(null,'',location.href)}catch(_){}
let backHash='',userHash='';
window.addEventListener('popstate',()=>{if(ignorePop){if(!fwdDone){if(history.state&&history.state.gvModal){fwdDone=true;history.forward();return}if(location.hash!==backHash){userHash=location.hash;return}}fwdDone=false;ignorePop=false;backInFlight=false;if(userHash){const h=userHash;userHash='';if(location.hash!==h){location.hash=h;return}}if(pushWanted){pushWanted=false;if(document.getElementById('ov'))histPush()}return}if(modalHist)closeModal(true)});
let modalOpener=null;
function openModal(html,cls=''){
  const root=document.getElementById('modalRoot');
  if(!document.getElementById('ov'))modalOpener=document.activeElement;
  root.innerHTML=`<div class="ov" id="ov"><div class="modal ${cls}" role="dialog" aria-modal="true" tabindex="-1"><button class="iconbtn mclose" id="mclose" aria-label="${t('close')}">✕</button>${html}</div></div>`;
  {const md=root.querySelector('.modal'),h=md.querySelector('h1,h2,h3');if(h){h.id=h.id||'mtitle';md.setAttribute('aria-labelledby',h.id)}try{md.focus({preventScroll:true})}catch(_){}}
  document.body.style.overflow='hidden';
  if(backPending){clearTimeout(backPending);backPending=null;modalHist=true}else if(!modalHist&&!pushWanted)histPush();
  root.querySelector('#mclose').onclick=()=>closeModal();
  root.querySelector('#ov').addEventListener('mousedown',e=>{if(e.target.id==='ov')closeModal()});
  return root.querySelector('.modal');
}
function confirmBox(msg){return new Promise(res=>{
  const m=openModal(`<div class="mpad"><p style="margin:10px 30px 20px 0">${esc(msg)}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="cNo">${t('cancel')}</button><button class="btn primary" id="cYes">${t('confirm')}</button></div></div>`,'sm');
  m.querySelector('#cNo').onclick=()=>{closeModal();res(false)};
  m.querySelector('#cYes').onclick=()=>{closeModal();res(true)};
})}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
/* images: TCGdex (card language) → TCGdex EN → Scrydex (EN scans, covers very recent sets) → text */
const SCRYDEX_SET={'30th':'me55','30th-c':'me55c'};
// sets whose numbering differs on Scrydex: explicit localId → number map, unknown cards get no fallback
const SCRYDEX_NUM={'30th-c':{'001':'4','002':'5','003':'11','004':'11g','005':'18','006':'19','007':'25','008':'33','009':'41','010':'43','011':'47','012':'50','013':'57','014':'58','015':'69','016':'85','017':'89','018':'94','019':'99','020':'100','021':'101','022':'106p','023':'106m','024':'106','025':'108','026':'114','027':'123','028':'138','029':'149','030':'203'}};
function scrydexId(setId,localId){
  if(!setId||!localId)return null;
  if(SCRYDEX_NUM[setId]){const n=SCRYDEX_NUM[setId][localId];return n?SCRYDEX_SET[setId]+'-'+n:null}
  let s=SCRYDEX_SET[setId];
  if(!s){const m=/^([a-z]+)0*(\d+)(\.5)?([a-z]*)$/i.exec(setId);s=m?m[1]+m[2]+(m[3]?(m[1]==='sm'?'5':'pt5'):'')+m[4]:setId}
  const l=/^\d+$/.test(localId)?String(parseInt(localId,10)):localId;
  return s+'-'+l;
}
function imgCandidates(base,setId,localId,q,lang=''){
  if(base&&base.startsWith('https://cards.scryfall.io/'))return[q==='high'?base.replace('/normal/','/large/'):base];
  if(base&&base.startsWith('https://optcgapi.com/'))return[base];
  if(lang==='ja'||(base&&base.includes('/ja/')))return base?[`${base}/${q==='high'?'high.webp':'low.webp'}`]:[];
  const out=[],ext=q==='high'?'high.webp':'low.webp';
  if(base){out.push(`${base}/${ext}`);if(base.includes('/fr/'))out.push(`${base.replace('/fr/','/en/')}/${ext}`)}
  const sid=scrydexId(setId,localId);if(sid)out.push(`https://images.scrydex.com/pokemon/${encodeURIComponent(sid)}/${q==='high'?'large':'medium'}`);
  return out;
}
const noImg=new Set(LS.get('pf_noimg',[]).filter(x=>typeof x==='string'));let noImgT=null;
const noImgSave=()=>{clearTimeout(noImgT);noImgT=setTimeout(()=>LS.set('pf_noimg',[...noImg].slice(-2000)),400)};
window.pfImgLoad=el=>{const w=el.naturalWidth,h=el.naturalHeight;if(el.src.includes('scrydex')&&((w===367&&h===511)||(w===640&&h===892)||(w===245&&h===341))){pfImgErr(el);return}if(el.dataset.k&&noImg.delete(el.dataset.k))noImgSave()};
window.pfImgErr=el=>{const c=(el.dataset.c||'').split('|').filter(Boolean);if(c.length){el.dataset.c=c.slice(1).join('|');el.src=c[0]}else{if(el.dataset.k&&!noImg.has(el.dataset.k)){noImg.add(el.dataset.k);noImgSave()}const d=document.createElement('div');d.className='noimg';d.textContent=el.alt;el.replaceWith(d)}};
function imgTag(base,setId,localId,alt,q='low',cls='',lang=''){
  const c=imgCandidates(base,setId,localId,q,lang),k=lang&&setId&&localId?`${lang}|${setId}|${localId}`:'';
  if(!c.length){if(k&&!noImg.has(k)){noImg.add(k);noImgSave()}return `<div class="noimg">${esc(alt)}</div>`}
  return `<img ${cls?`class="${cls}"`:''} loading="lazy" src="${esc(c[0])}" data-c="${esc(c.slice(1).join('|'))}"${k?` data-k="${esc(k)}"`:''} alt="${esc(alt)}" data-err="pf">`;
}
const gradeStr=e=>e?.grade?.co?`${e.grade.co} ${e.grade.g}`:'';
// number as printed on the card, for marketplace searches: letter cards (Mew R/G/B → "R/RGB"),
// galleries (TG05 → "TG05/TG30", GG12 → "GG12/GG70": the total is the highest number of that prefix in the set)
function printedNum(setId,localId,off,lang){
  const l=String(localId||'');
  if(/^[RGB]$/.test(l))return l+'/RGB';
  const m=l.match(/^([A-Z]+)(\d+)$/);
  if(m){const cards=idx[lang]?.cards||idx.en?.cards||[];let max=0;
    for(const c of cards){if(c.s!==setId)continue;const k=String(c.l).match(/^([A-Z]+)(\d+)$/);if(k&&k[1]===m[1])max=Math.max(max,+k[2])}
    return max?`${l}/${m[1]}${String(max).padStart(m[2].length,'0')}`:l}
  return numLabel(l,off);
}
function ebayUrl(name,num,setName,grade,lang,setId,sold=true,game='pk',id=''){
  const host=settings.lang==='fr'?'www.ebay.fr':'www.ebay.com';
  // a raw card is compared with raw cards (graded slabs sell at other prices), and obvious fakes are left out
  const X=[grade?'':'-psa -bgs -cgc -graded -gradée -gradé','-proxy -custom -orica -replica'].filter(Boolean).join(' ');
  if(game==='op'){const L={fr:'-english -anglais -eng -japanese -japonais -jap',en:'-japanese -japonais -jap -jpn -francais -français -french',ja:'japanese'}[lang]||'';
    const ver={par:'parallel',alt:'"alternate art"',manga:'manga',sp:'SP'}[opVerOfId(id)]??'-parallel -manga -"alt art" -alternate -sp -gold',nm=String(name||'').replace(/\./g,' ').replace(/\s+/g,' ').trim();
    return `https://${host}/sch/i.html?_nkw=${encodeURIComponent(['one piece',num,nm,ver,grade,L,X].filter(Boolean).join(' '))}${sold?'&LH_Sold=1&LH_Complete=1':'&_sop=15'}`}
  if(game==='mg'){const L={fr:'-english -anglais -anglaise -eng',en:'-francais -français -french -vf'}[lang]||'';
    return `https://${host}/sch/i.html?_nkw=${encodeURIComponent(['mtg',name,setName,grade,L,X].filter(Boolean).join(' '))}${sold?'&LH_Sold=1&LH_Complete=1':'&_sop=15'}`}
  // card language: exclude the OTHER languages (many sellers don't state the language of their own card); the number already pins the card, so the set name is left out
  const L={fr:'-english -anglais -anglaise -eng -japanese -japonais -japonaise -jap -jpn',en:'-francais -français -francaise -française -french -vf -japanese -japonais -japonaise -jap -jpn'}[lang];
  const q=lang==='ja'?['pokemon japanese',setId,num,grade,X].filter(Boolean).join(' '):[name,num,grade,L,X].filter(Boolean).join(' ');
  // sold = completed sales (to value a card); otherwise live listings, cheapest first incl. shipping (to buy it)
  return `https://${host}/sch/i.html?_nkw=${encodeURIComponent(q)}&_sacat=183454${sold?'&LH_Sold=1&LH_Complete=1':'&_sop=15'}`;
}
function cmUrl(name,setName,game='pk',direct=''){
  if(game==='op')return `https://www.cardmarket.com/${settings.lang==='fr'?'fr':'en'}/OnePiece/Products/Search?searchString=${encodeURIComponent(name)}`;
  // a link given by the source is used only if it really goes to Cardmarket (a javascript: or foreign link would run or redirect)
  if(game==='mg')return (/^https:\/\/(www\.)?cardmarket\.com\//.test(direct)?direct:'')||`https://www.cardmarket.com/${settings.lang==='fr'?'fr':'en'}/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;
  return `https://www.cardmarket.com/${settings.lang==='fr'?'fr':'en'}/Pokemon/Products/Search?searchString=${encodeURIComponent(name+(setName?' '+setName:''))}`;
}
const numLabel=(l,off)=>off&&/^\d+$/.test(l)?`${l}/${String(off).padStart(String(l).replace(/\D/g,'').length||1,'0')}`:l;

/* ============ accounts & cloud sync (Supabase) ============ */
const SB_URL='https://ufowenlhdsaezyshhwgz.supabase.co';
const SB_KEY='sb_publishable_jABVuv0ZIqBTt9GLTxnTVg_imtAaAqk';
const APP_URL=location.origin+location.pathname;
let sb=null,user=null,authKnown=false,syncState='off',syncTimer=null,syncing=false,syncAgain=false;
// resolved once the first sync after launch is over (or right away when there is no account): the splash waits for it, briefly
let bootSyncDone;const bootSync=new Promise(r=>bootSyncDone=r);
// the accounts library is downloaded in parallel (preloaded in <head>) instead of blocking the first display
let sbReady=null;
function initSupabase(){sbReady=(window.supabase?.createClient?Promise.resolve():loadScript(LIBS.sb.src,LIBS.sb.sri)).then(setupSupabase,()=>{bootSyncDone();authSettled()})}
// the account is only known once Supabase has read the saved session (loaded in the background): until then no « guest » reminder
function authSettled(){if(authKnown)return;authKnown=true;if(backupDue()&&!document.getElementById('bkBan')&&view==='collection')render()}
function setupSupabase(){
  if(!window.supabase?.createClient){bootSyncDone();authSettled();return}
  try{
    sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  }catch(e){sb=null;bootSyncDone();authSettled();return}
  sb.auth.onAuthStateChange((ev,session)=>{
    const prev=user?.id;user=session?.user||null;
    if(ev==='PASSWORD_RECOVERY')setTimeout(openRecovery,0);
    if(user&&user.id!==prev){cleanUrl();setTimeout(()=>syncNow(true),0)}
    if(!user){syncState='off';bootSyncDone()}
    if(user)document.getElementById('bkBan')?.remove();
    renderShell();authSettled();
  });
}
function cleanUrl(){if(/[?&]code=/.test(location.search))history.replaceState(null,'',location.pathname+(VIEWS.includes(location.hash.slice(1))?location.hash:''))}
function setSync(s){syncState=s;renderShell();const el=document.getElementById('syncInfo');if(el)el.innerHTML=syncLabel()}
function syncLabel(){return syncState==='ok'?'✓ '+t('sync_ok',{d:new Date(settings.lastSync||Date.now()).toLocaleTimeString(settings.lang==='fr'?'fr-FR':'en-GB',{hour:'2-digit',minute:'2-digit'})}):syncState==='syncing'?t('sync_running'):syncState==='error'?'⚠ '+t('sync_error'):t('sync_off')}
function scheduleSync(){if(!user)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),1500)}
const tsOf=e=>e.upd||e.added||0;
function mergeEntry(a,b){ // a = winner (newer user edit), b = other copy: keep the freshest price data
  const r={...a};
  if((b.price?.updated||'')>(a.price?.updated||'')){r.price=b.price;r.tcp=b.tcp}
  if(b.hist?.length){const m=new Map((a.hist||[]).map(h=>[h.d,h]));for(const h of b.hist)if(!m.has(h.d))m.set(h.d,h);r.hist=[...m.values()].sort((x,y)=>x.d.localeCompare(y.d)).slice(-400)}
  return r;
}
function mergeData(local,remote){
  const del={...(remote.del||{})};for(const[k,v]of Object.entries(local.del||{}))del[k]=Math.max(del[k]||0,v);
  const map=new Map();
  for(const e of[...(remote.collection||[]),...(local.collection||[])]){
    if(!e||!e.uid||(del[e.uid]&&del[e.uid]>=tsOf(e)))continue;
    const cur=map.get(e.uid);
    if(!cur)map.set(e.uid,e);else map.set(e.uid,tsOf(e)>=tsOf(cur)?mergeEntry(e,cur):mergeEntry(cur,e));
  }
  const snaps=new Map();for(const s of[...(remote.snapshots||[]),...(local.snapshots||[])])snaps.set(s.d,s);
  const limit=Date.now()-120*864e5;for(const k of Object.keys(del))if(del[k]<limit)delete del[k];
  return{collection:[...map.values()],snapshots:[...snaps.values()].sort((a,b)=>a.d.localeCompare(b.d)),del};
}
async function syncNow(first){
  await collReady;   // never merge into a collection not yet read from storage
  if(!sb||!user||updBlocked)return;
  if(syncing){syncAgain=true;return}
  syncing=true;setSync('syncing');
  try{
    const before=JSON.stringify(collection);
    const{data,error}=await sb.from('user_data').select('data').eq('user_id',user.id).maybeSingle();
    if(error)throw error;
    const merged=mergeData({collection,snapshots,del:deleted},data?.data||{});
    collection=cleanList(merged.collection);snapshots=cleanSnaps(merged.snapshots);deleted=merged.del;
    persistColl(true);LS.set('pf_snapshots',snapshots);LS.set('pf_deleted',deleted);
    const{error:e2}=await sb.from('user_data').upsert({user_id:user.id,data:{v:1,collection,snapshots,del:deleted},updated_at:new Date().toISOString()});
    if(e2)throw e2;
    settings.lastSync=Date.now();saveSettings();setSync('ok');
    if(settings.shareOn&&settings.shareOn===user.id)sharePush().catch(()=>{});
    else if(settings.shareOn===true)shareGet().then(r=>{settings.shareOn=r?user.id:false;saveSettings();if(r)sharePush()}).catch(()=>{}); // links made before the per-account flag
    if(JSON.stringify(collection)!==before&&!document.querySelector('.ov'))render();
    if(first)toast(t('sync_first',{n:collection.length}));
  }catch(err){console.warn('sync',err);setSync('error')}
  syncing=false;bootSyncDone();
  if(syncAgain){syncAgain=false;syncNow()}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncNow()});
function authErr(e){
  const m=String(e?.message||e||'');
  if(/invalid login/i.test(m))return t('err_login');
  if(/not confirmed/i.test(m))return t('err_confirm');
  if(/already registered|already exists/i.test(m))return t('err_exists');
  if(/security purposes|after \d+ seconds/i.test(m))return t('err_wait');
  if(/rate limit|too many/i.test(m))return t('err_rate');
  if(/password/i.test(m))return t('err_pwd')+' ('+m+')';
  return m||t('err_net');
}
function pillControl(label=true){
  const cur=settings.pill||'m';
  return `<div class="pillset">${label?`<div class="small muted" style="margin-bottom:6px">${t('pill_size')}</div>`:''}<div class="seg" role="radiogroup">${['s','m','l'].map(k=>`<button type="button" data-pill="${k}" class="${cur===k?'on':''}" role="radio" aria-checked="${cur===k}"><span class="pdemo pd-${k}">3</span>${t('pill_'+k)}</button>`).join('')}</div></div>`;
}
function bindPill(root){root.querySelectorAll('[data-pill]').forEach(b=>{if(b.tagName!=='BUTTON')return;b.onclick=()=>{settings.pill=b.dataset.pill;saveSettings();document.documentElement.dataset.pill=settings.pill;root.querySelectorAll('button[data-pill]').forEach(x=>{const on=x.dataset.pill===settings.pill;x.classList.toggle('on',on);x.setAttribute('aria-checked',on)})}})}
async function openAccount(){
  if(!sb&&sbReady)await sbReady;
  if(!sb){const m=openModal(`<div class="mpad"><h2 style="margin-top:0">${t('account')}</h2><p>${t('sb_unavailable')}</p></div>`,'sm');return}
  if(user){
    const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 6px 0">${t('account')}</h2>
      <p class="muted">${esc(user.email)}</p><p id="syncInfo">${syncLabel()}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn primary" id="aSync">↻ ${t('sync_now')}</button><button class="btn" id="aOut">${t('logout')}</button></div>
      <h3 style="margin:22px 0 10px;font-size:15px">${t('display')}</h3>${pillControl()}
      <p style="margin:26px 0 0"><button class="linkbtn danger-link" id="aDel" type="button">${t('del_acc')}</button></p></div>`,'sm');
    bindPill(m);
    // account deletion (GDPR): typed confirmation, then the server removes the account and its data; cards stay on this device
    m.querySelector('#aDel').onclick=()=>{
      const m3=openModal(`<div class="mpad"><h2 style="margin:0 40px 8px 0">${t('del_acc')}</h2><p>${t('del_acc_d')}</p>
        <label class="small muted" for="delWord">${t('del_acc_type',{w:t('del_acc_word')})}</label><input id="delWord" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" style="margin:6px 0 14px">
        <p class="small" id="delMsg" role="alert"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="delNo" type="button">${t('cancel')}</button><button class="btn danger" id="delYes" type="button" disabled>${t('del_acc_btn')}</button></div></div>`,'sm auth');
      const w=m3.querySelector('#delWord'),yes=m3.querySelector('#delYes');
      w.oninput=()=>{yes.disabled=w.value.trim().toUpperCase()!==t('del_acc_word').toUpperCase()};
      m3.querySelector('#delNo').onclick=()=>closeModal();
      yes.onclick=async()=>{yes.disabled=true;const msg=m3.querySelector('#delMsg');msg.textContent='…';
        try{const{error}=await sb.rpc('delete_my_account');if(error)throw error;
          await sb.auth.signOut().catch(()=>{});user=null;closeModal();toast(t('del_acc_done'));render()}
        catch(e){logErr('delete account: '+(e?.message||e),'rpc');msg.textContent=/function|does not exist|404|PGRST202/i.test(String(e?.message||e?.code||''))?t('del_acc_missing'):t('err_net');yes.disabled=false}};
    };
    m.querySelector('#aSync').onclick=()=>syncNow();
    m.querySelector('#aOut').onclick=()=>{
      const m2=openModal(`<div class="mpad"><p style="margin:10px 30px 18px 0">${t('logout_q')}</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn" id="oKeep">${t('logout_keep')}</button><button class="btn danger" id="oWipe">${t('logout_wipe')}</button></div></div>`,'sm');
      const out=async wipe=>{await syncNow();await sb.auth.signOut();if(wipe){collection=[];snapshots=[];deleted={};persistColl(true);LS.set('pf_snapshots',[]);LS.set('pf_deleted',{})}closeModal();toast(t('logged_out'));render()};
      m2.querySelector('#oKeep').onclick=()=>out(false);m2.querySelector('#oWipe').onclick=()=>out(true);
    };
    return;
  }
  openLogin();
}
// shared by the login and sign-up forms: shows that an attempt is running, locks the buttons, always ends with a visible answer
function authForm(f,msg){
  const say=(x,ok)=>{msg.textContent=x;msg.style.color=ok?'var(--ok)':'var(--ko)'};
  const run=async(wait,fn)=>{
    if(f.dataset.busy)return;f.dataset.busy='1';const btns=[...f.querySelectorAll('button')];btns.forEach(b=>b.disabled=true);msg.style.color='';msg.textContent=t(wait);
    try{await Promise.race([fn(),new Promise((_,ko)=>setTimeout(()=>ko(new Error('timeout')),20000))])}
    catch(e){logErr('auth: '+(e?.message||e),'auth');say(/timeout/.test(String(e?.message))?t('err_timeout'):authErr(e))}
    finally{delete f.dataset.busy;btns.forEach(b=>b.disabled=false)}};
  return{say,run};
}
// login only: a single main button, so a quick tap can never create an account by mistake; sign-up is its own form
function openLogin(prefill){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 6px 0">${t('login')}</h2><p class="muted small">${t('account_why')}</p>
    <form class="form" id="aForm" style="grid-template-columns:1fr">
      <label>E-mail<input maxlength="254" type="email" name="email" required autocomplete="email" value="${esc(prefill||'')}"></label>
      <label>${t('password_plain')}${pwdField('pwd','current-password')}</label>
      <p id="aMsg" class="small" style="margin:0"></p>
      <div><button class="btn primary" type="submit">${t('login')}</button></div>
      <button class="linkbtn" type="button" id="aForgot" style="justify-self:start">${t('forgot')}</button>
      <p class="small" style="margin:8px 0 0;border-top:1px solid var(--line,rgba(127,127,127,.25));padding-top:12px">${t('no_account')} <button class="linkbtn" type="button" id="aGoUp">${t('signup')}</button></p>
    </form></div>`,'sm auth');
  bindPwdToggles(m);
  const f=m.querySelector('#aForm'),{say,run}=authForm(f,m.querySelector('#aMsg'));
  if(matchMedia('(hover: hover) and (pointer: fine)').matches)setTimeout(()=>(f.email.value?f.pwd:f.email).focus(),30);
  f.onsubmit=ev=>{ev.preventDefault();say('');
    if(!f.email.checkValidity()||!f.pwd.value){say(t('err_fields_login'));return}
    run('auth_login',async()=>{
      const{error}=await sb.auth.signInWithPassword({email:f.email.value.trim(),password:f.pwd.value});
      if(error)throw error;closeModal();toast(t('logged_in'))})};
  m.querySelector('#aGoUp').onclick=()=>openSignup(f.email.value.trim());
  m.querySelector('#aForgot').onclick=()=>openForgot(f.email.value.trim());
}
function openSignup(prefill){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 6px 0">${t('signup')}</h2><p class="muted small">${t('account_why')}</p>
    <form class="form" id="uForm" style="grid-template-columns:1fr">
      <label>E-mail<input maxlength="254" type="email" name="email" required autocomplete="email" value="${esc(prefill||'')}"></label>
      <label>${t('password')}${pwdField('pwd','new-password')}</label>
      <label>${t('pwd_confirm')}${pwdField('pwd2','new-password')}</label>
      <p id="uMsg" class="small" style="margin:0"></p>
      <div><button class="btn primary" type="submit">${t('signup_go')}</button></div>
      <p class="small" style="margin:8px 0 0;border-top:1px solid var(--line,rgba(127,127,127,.25));padding-top:12px">${t('have_account')} <button class="linkbtn" type="button" id="uGoIn">${t('login')}</button></p>
    </form></div>`,'sm auth');
  bindPwdToggles(m);
  const f=m.querySelector('#uForm'),{say,run}=authForm(f,m.querySelector('#uMsg'));
  if(matchMedia('(hover: hover) and (pointer: fine)').matches)setTimeout(()=>(f.email.value?f.pwd:f.email).focus(),30);
  f.onsubmit=ev=>{ev.preventDefault();say('');
    if(!f.email.checkValidity()||f.pwd.value.length<PWD_MIN){say(t('err_fields'));return}
    if(f.pwd.value!==f.pwd2.value){say(t('err_pwd_match'));return}
    run('auth_signup',async()=>{
      const{data,error}=await sb.auth.signUp({email:f.email.value.trim(),password:f.pwd.value,options:{emailRedirectTo:APP_URL}});
      if(error)throw error;
      // address already used: Supabase answers « ok » without creating anything (no identity) so as not to reveal it
      if(data?.user&&Array.isArray(data.user.identities)&&!data.user.identities.length){say(t('err_exists'));return}
      if(data?.session){closeModal();toast(t('logged_in'));return}
      f.querySelectorAll('input').forEach(i=>i.disabled=true);f.querySelector('[type=submit]').hidden=true;say(t('check_mail'),true)})};
  m.querySelector('#uGoIn').onclick=()=>openLogin(f.email.value.trim());
}
const PWD_MIN=8;
const EYE='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7c2 0 3.8.7 5.2 1.6M22 12s-3.6 7-10 7c-2 0-3.8-.7-5.2-1.6"/><path d="M3 3l18 18"/></svg>';
function pwdField(name,ac){return `<span class="pwdwrap"><input type="password" name="${name}" autocomplete="${ac}" ${ac==='new-password'?`minlength="${PWD_MIN}"`:''}><button type="button" class="pwdeye" aria-label="${t('show_pwd')}" title="${t('show_pwd')}">${EYE}</button></span>`}
function bindPwdToggles(root){root.querySelectorAll('.pwdeye').forEach(b=>b.onclick=()=>{const i=b.previousElementSibling,show=i.type==='password';i.type=show?'text':'password';b.innerHTML=show?EYE_OFF:EYE;b.title=b.ariaLabel=t(show?'hide_pwd':'show_pwd');i.focus()})}
function openForgot(prefill){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 6px 0">${t('forgot_title')}</h2><p class="muted small">${t('forgot_why')}</p>
    <form class="form" id="fForm" style="grid-template-columns:1fr">
      <label>E-mail<input maxlength="254" type="email" name="email" required autocomplete="email" value="${esc(prefill||'')}"></label>
      <p id="fMsg" class="small" style="margin:0"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="submit">${t('forgot_send')}</button><button class="btn" type="button" id="fBack">${t('back')}</button></div>
    </form></div>`,'sm auth');
  const f=m.querySelector('#fForm'),msg=m.querySelector('#fMsg');
  if(matchMedia('(hover: hover) and (pointer: fine)').matches)setTimeout(()=>f.email.focus(),30);
  m.querySelector('#fBack').onclick=()=>openLogin(f.email.value.trim());
  f.onsubmit=async ev=>{ev.preventDefault();
    if(!f.email.checkValidity()){msg.textContent=t('err_email');msg.style.color='var(--ko)';return}
    const btn=f.querySelector('[type=submit]');btn.disabled=true;
    const{error}=await sb.auth.resetPasswordForEmail(f.email.value.trim(),{redirectTo:APP_URL});
    btn.disabled=false;msg.textContent=error?authErr(error):t('reset_sent');msg.style.color=error?'var(--ko)':'var(--ok)'};
}
function openRecovery(){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 10px 0">${t('new_pwd')}</h2><form class="form" id="rForm" style="grid-template-columns:1fr">
    <label>${t('password')}${pwdField('pwd','new-password')}</label>
    <p id="rMsg" class="small" style="margin:0;color:var(--ko)"></p><div><button class="btn primary" type="submit">${t('save')}</button></div></form></div>`,'sm auth');
  bindPwdToggles(m);
  const f=m.querySelector('#rForm');
  f.onsubmit=async ev=>{ev.preventDefault();if(f.pwd.value.length<PWD_MIN){m.querySelector('#rMsg').textContent=t('err_pwd_len');return}
    const{error}=await sb.auth.updateUser({password:f.pwd.value});if(error)m.querySelector('#rMsg').textContent=authErr(error);else{closeModal();toast(t('saved'))}};
}

/* ============ routing & shell ============ */
const VIEWS=['collection','add','wishlist','evolution','data'];
// a shared wishlist link (?w=token) opens a read-only page instead of the app
const SHARED_TOKEN=(new URLSearchParams(location.search).get('w')||'').replace(/[^a-f0-9]/gi,'').slice(0,64)||null;
const TAB_ICONS={
  collection:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
  add:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  wishlist:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  evolution:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M15 7h3v3"/></svg>',
  data:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
let view='collection';
let cgShown=0,cgObs=null;
function route(){const prev=view;view=VIEWS.includes(location.hash.slice(1))?location.hash.slice(1):'collection';if(prev!==view)cgShown=0;render();if(prev!==view){const mm=document.getElementById('main');if(mm)mm.scrollTop=0;window.scrollTo(0,0)}}
window.addEventListener('hashchange',route);

function renderShell(){
  document.documentElement.lang=settings.lang;
  document.documentElement.dataset.theme=settings.theme;
  document.documentElement.dataset.pill=settings.pill||'m';
  if(settings.hidePrices)document.documentElement.dataset.priv='1';else delete document.documentElement.dataset.priv;
  const labels={collection:'nav_collection',add:'nav_add',wishlist:'nav_wish',evolution:'nav_evo',data:'nav_data'};
  document.getElementById('nav').innerHTML=VIEWS.map(v=>`<a href="#${v}" class="${v===view?'active':''}">${t(labels[v])}</a>`).join('');
  document.getElementById('tabbar').innerHTML=VIEWS.map(v=>`<a href="#${v}" class="${v===view?'active':''}" ${v===view?'aria-current="page"':''}>${TAB_ICONS[v]}<span>${t(labels[v])}</span></a>`).join('');
  const pb=document.getElementById('privBtn');pb.innerHTML=settings.hidePrices?EYE_HIDDEN:EYE_ON;pb.classList.toggle('on',!!settings.hidePrices);pb.title=t(settings.hidePrices?'priv_show':'priv_hide');pb.setAttribute('aria-label',pb.title);pb.setAttribute('aria-pressed',!!settings.hidePrices);
  const ab=document.getElementById('accBtn');
  ab.title=user?user.email:t('login');
  ab.innerHTML=user?`<span class="acc-av">${esc((user.email||'?')[0].toUpperCase())}</span><span class="dot ${syncState}"></span>`
    :`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`;
}
document.getElementById('accBtn').onclick=()=>openAccount();
function openGameView(){
  const used=gamesUsed(),wish=view==='wishlist',cnt=g=>collection.filter(e=>(wish?e.status==='wish':e.status!=='wish')&&(!g||gameOf(e)===g)).reduce((a,e)=>a+(e.qty||1),0),cur=gvActive()?settings.gameView:'all';
  const opts=[['all',t('game_all')],...Object.keys(GAMES).filter(g=>used.has(g)).map(g=>[g,GAMES[g].n])].map(([g,l])=>`<button type="button" class="g-opt ${g===cur?'on':''}" data-g="${g}" role="menuitemradio" aria-checked="${g===cur}">${g==='all'?'<span class="gdot all"></span>':gdot(g)}<span>${l}</span><small>${t('n_cards',{n:cnt(g==='all'?null:g)})}</small></button>`).join('');
  const pick=g=>{settings.gameView=g;saveSettings();render()};
  {const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 10px 0">${t('game_pick')}</h2>${opts}</div>`,'sm');
    m.querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>{closeModal();pick(b.dataset.g)})}
}
// game filter chip shown under the page title (only with several games)
function gameChip(){if(!multiGame())return'';const cur=gvActive()?settings.gameView:'all',wish=view==='wishlist',used=gamesUsed();
  const cnt=g=>collection.filter(e=>(wish?e.status==='wish':e.status!=='wish')&&(g==='all'||gameOf(e)===g)).reduce((a,e)=>a+(e.qty||1),0);
  return `<div class="gv-row" role="radiogroup" aria-label="${esc(t('game_pick'))}">${['all',...Object.keys(GAMES).filter(g=>used.has(g))].map(g=>`<button type="button" class="gv-b ${g===cur?'on':''}" data-gsel="${g}" role="radio" aria-checked="${g===cur}">${g==='all'?'<span class="gdot all" aria-hidden="true"></span>':gdot(g)}<span>${g==='all'?t('game_all_s'):GAMES[g].n}</span><em>${cnt(g)}</em></button>`).join('')}</div>`}
// re-tapping the Collection tab while on Collection opens the game list
document.addEventListener('click',ev=>{const a=ev.target.closest('#tabbar a[href="#collection"],#nav a[href="#collection"]');if(a&&view==='collection'&&multiGame()&&!document.getElementById('ov')){ev.preventDefault();openGameView()}},true);
const EYE_ON='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>';
const EYE_HIDDEN='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="currentColor" fill-opacity=".25"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';
function setPriv(on){settings.hidePrices=on;saveSettings();toast(t(on?'priv_on':'priv_off'));render()}
document.getElementById('privBtn').onclick=()=>setPriv(!settings.hidePrices);
document.getElementById('themeBtn').onclick=()=>{settings.theme=settings.theme==='dark'?'light':'dark';saveSettings();render()};
function setLang(l){settings.lang=l;saveSettings();for(const L of ['fr','en','ja'])if(idx[L])applySetNames(L,idx[L]);syncEntrySetNames();search.page=1;render()}
// keep the set names stored in the collection in line with the display names (French for English/Japanese cards)
function syncEntrySetNames(){let ch=false;for(const e of collection){if(gameOf(e)!=='pk')continue;const nm=idx[e.lang]?.sets[e.setId]?.n;if(nm&&nm!==e.setName){e.setName=nm;ch=true}}if(ch)persistColl();return ch}

let charts=[];
function render(){
  charts.forEach(c=>c.destroy());charts=[];
  renderShell();
  const m=document.getElementById('main');
  if(SHARED_TOKEN){document.documentElement.dataset.shared='1';viewShared(m);return}
  m.dataset.view=view;
  if(!collSettled&&!collTimedOut&&view!=='data'){m.innerHTML=`<div class="empty coll-wait"><span class="spin"></span><p class="muted">${t('coll_loading')}</p></div>`;return}
  if(collStuck&&view!=='data'){m.innerHTML=`<div class="empty"><div style="font-size:40px">⏳</div><h2>${t('coll_stuck_t')}</h2><p class="muted">${t('coll_stuck_d')}</p><button class="btn primary" type="button" data-act="reload">${t('coll_stuck_btn')}</button></div>`;return}
  ({collection:viewCollection,add:viewAdd,wishlist:viewWish,evolution:viewEvo,data:viewData})[view](m);
  m.querySelectorAll('[data-gsel]').forEach(b=>b.onclick=()=>{if(b.classList.contains('on'))return;settings.gameView=b.dataset.gsel;saveSettings();const mn=document.getElementById('main'),x=scrollY,y=mn.scrollTop;render();scrollTo(0,x);mn.scrollTop=y});
  m.querySelector('.gv-b.on')?.scrollIntoView({inline:'nearest',block:'nearest'});
}

/* ============ view: collection ============ */
const cfilter={q:'',set:'',lang:''};let cfOpen=false;
function viewCollection(m){
  const owned=collection.filter(e=>e.status!=='wish'&&inView(e));
  const tt=totals(owned);
  const gainCls=tt.gain>=0?'pos':'neg';
  const sets=[...new Map(owned.map(e=>[e.lang+':'+e.setId,{k:e.setId,n:e.setName}])).values()];
  m.innerHTML=`
  ${owned.length&&settings.hidePrices?`<div class="sumbar safe"><span class="safe-tx">🛡 ${t('safe_banner')}</span><button class="btn btn-sm" id="safeOff">${t('safe_off_short')}</button></div>`:''}
  ${owned.length&&!settings.hidePrices?`<a class="sumbar sb-b" href="#evolution">
    <span class="sb-v"><span class="muted sb-lab">${t('stat_value')}</span> <b>${fmtEur(tt.value)}</b></span>
    ${tt.withCost?`<span class="sb-g ${gainCls}">${(settings.hidePrices?'':tt.gain>=0?'+':'')+fmtEur(tt.gain)} <span class="small">(${fmtPct(tt.gainPct)})</span></span>`:''}
    ${(()=>{const n=priceSuspects(owned).length;return n?`<span class="sb-chk" id="sbChk" role="button" tabindex="0" title="${esc(t('chk_pill_tip',{n}))}">⚠ ${n}<span class="sb-chk-l"> ${t('chk_pill_l')}</span></span>`:''})()}
    <span class="sb-go">${t('see_value')} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
  </a>`:''}
  ${alertsBanner(e=>e.status!=='wish')}${manualBanner()}${backupBanner()}
  <div class="coll-head">
    <h2 class="tbtitle">${t('my_collection')} <span class="muted small">(${tt.count})</span></h2>
    <a class="btn primary btn-sm" href="#add"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>${t('add_short')}</a>
  </div>${gameChip()}
  ${owned.length?`
  <div class="cfilters">
    <div class="cf-row">
      <label class="searchbox"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input maxlength="100" type="text" id="cq" placeholder="${t('filter_collection')}" value="${esc(cfilter.q)}"></label>
      <button type="button" class="btn cf-toggle ${cfOpen?'on':''}" id="cfToggle" aria-expanded="${cfOpen}" aria-label="${t('filters')}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg><span class="cf-lbl">${t('filters')}</span><span class="cf-count" id="cfCount"></span></button>
    </div>
    <div class="cf-panel ${cfOpen?'open':''}" id="cfPanel">
      <select id="cset" aria-label="${t('set')}"><option value="">${t('all_sets')}</option>${sets.sort((a,b)=>a.n.localeCompare(b.n)).map(s=>`<option value="${esc(s.k)}" ${cfilter.set===s.k?'selected':''}>${esc(s.n)}</option>`).join('')}</select>
      <select id="clang" aria-label="${t('card_lang')}"><option value="">${t('all_langs')}</option><option value="fr" ${cfilter.lang==='fr'?'selected':''}>Français</option><option value="en" ${cfilter.lang==='en'?'selected':''}>English</option><option value="ja" ${cfilter.lang==='ja'?'selected':''}>日本語</option></select>
      <select id="csort" class="cf-sort" aria-label="${t('sort_label')}">${['value','gain','added','name','set'].map(s=>`<option value="${s}" ${settings.sort===s?'selected':''}>${t('sort_'+s)}</option>`).join('')}</select>
    </div>
  </div>
  <div class="grid" id="cgrid"></div>`:`<div class="empty"><p>${t('empty_collection')}</p><a class="btn primary" href="#add">＋ ${t('go_add')}</a></div>`}
  <p class="credit">${t(gamesUsed().has('mg')?'credit_short_mg':'credit_short')}${gamesUsed().has('op')?' · '+t('credit_op'):''} · <a href="#data">${t('about_more')}</a></p>`;
  const sc=m.querySelector('#sbChk');if(sc){const go=e=>{e.preventDefault();e.stopPropagation();openSuspectList()};sc.onclick=go;sc.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')go(e)}}
  const so=m.querySelector('#safeOff');if(so)so.onclick=()=>setPriv(false);
  bindAlerts(m,e=>e.status!=='wish');bindManualBanner(m);
  m.querySelectorAll('details.fold').forEach(d=>d.addEventListener('toggle',()=>{settings.fold={...(settings.fold||{}),[d.dataset.k]:d.open};saveSettings()}));
  m.querySelectorAll('.alerts [data-open]').forEach(el=>el.onclick=()=>openEntry(el.dataset.open));
  if(!owned.length)return;
  const draw=()=>{
    const q=norm(cfilter.q);
    let list=owned.filter(e=>(!q||norm(e.name+' '+e.setName+' '+e.localId).includes(q))&&(!cfilter.set||e.setId===cfilter.set)&&(!cfilter.lang||e.lang===cfilter.lang));
    const s=settings.sort;
    list.sort((a,b)=>s==='name'?a.name.localeCompare(b.name):s==='added'?b.added-a.added:s==='set'?(a.setName.localeCompare(b.setName)||(parseInt(a.localId)||0)-(parseInt(b.localId)||0)):s==='gain'?gainOf(b)-gainOf(a):(entryValue(b)||0)*b.qty-(entryValue(a)||0)*a.qty);
    // big collections: tiles are added by pages as the end of the grid comes into view (3 000 tiles at once took seconds on a phone).
    // How far the user had scrolled is kept across re-renders of this view (editing a card re-renders the page).
    const grid=m.querySelector('#cgrid'),CPAGE=120;if(cgObs){cgObs.disconnect();cgObs=null}
    let n=Math.min(list.length,Math.max(CPAGE,cgShown));cgShown=n;
    grid.innerHTML=list.slice(0,n).map(entryTile).join('');
    grid.onclick=ev=>{const el=ev.target.closest('[data-uid]');if(el&&grid.contains(el))openEntry(el.dataset.uid)};
    m.querySelector('#cmore')?.remove();
    if(n<list.length){grid.insertAdjacentHTML('afterend','<div id="cmore" class="more-sentinel"><span class="spin"></span></div>');
      const sent=m.querySelector('#cmore'),main=document.getElementById('main'),sc=/(auto|scroll)/.test(getComputedStyle(main).overflowY)?main:null;
      cgObs=new IntersectionObserver(es=>{if(!es.some(e=>e.isIntersecting)||!grid.isConnected)return;
        const next=list.slice(n,n+CPAGE);n+=next.length;cgShown=n;grid.insertAdjacentHTML('beforeend',next.map(entryTile).join(''));
        if(n>=list.length){sent.remove();cgObs.disconnect();cgObs=null}},{root:sc,rootMargin:'0px 0px 1200px 0px'});
      cgObs.observe(sent)}
  };
  const updCount=()=>{const n=(cfilter.set?1:0)+(cfilter.lang?1:0)+(settings.sort!=='value'?1:0);const c=m.querySelector('#cfCount');c.textContent=n||'';c.style.display=n?'':'none'};updCount();
  m.querySelector('#cfToggle').onclick=e=>{cfOpen=!cfOpen;m.querySelector('#cfPanel').classList.toggle('open',cfOpen);e.currentTarget.classList.toggle('on',cfOpen);e.currentTarget.setAttribute('aria-expanded',cfOpen)};
  m.querySelector('#cq').oninput=e=>{cfilter.q=e.target.value;cgShown=0;draw()};
  m.querySelector('#cset').onchange=e=>{cfilter.set=e.target.value;cgShown=0;updCount();draw()};
  m.querySelector('#clang').onchange=e=>{cfilter.lang=e.target.value;cgShown=0;updCount();draw()};
  m.querySelector('#csort').onchange=e=>{settings.sort=e.target.value;cgShown=0;saveSettings();updCount();draw()};
  draw();
  m.querySelectorAll('[data-open]').forEach(el=>el.onclick=()=>openEntry(el.dataset.open));
}
// total copies of the same card (same card, same language, same list: owned or wishlist), across all entries
const copyKey=x=>x.cardId+'|'+x.lang+'|'+(x.status==='wish'?1:0);
const copyCounts=taskCache(()=>{const m=new Map();for(const x of collection){const k=copyKey(x);m.set(k,(m.get(k)||0)+(x.qty||1))}return m});
const copiesOf=e=>copyCounts().get(copyKey(e))||0;
const gainOf=e=>e.buy>0&&entryValue(e)!=null?(entryValue(e)-e.buy)*e.qty:-Infinity;
function openDealSheet(){
  const cur=settings.dealPct||5;
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 6px 0">🏷 ${t('deal_cfg')}</h2><p class="muted small" style="margin:0 0 14px">${t('deal_cfg_d')}</p>
    <div class="ev-seg">${[5,10,15,20,25].map(p=>`<button type="button" data-dp="${p}" class="${p===cur?'on':''}">−${p} %</button>`).join('')}</div>
    <p class="muted small" style="margin:12px 0 0">${t('deal_cfg_n')}</p></div>`,'sm');
  m.querySelectorAll('[data-dp]').forEach(b=>b.onclick=()=>{settings.dealPct=+b.dataset.dp;saveSettings();closeModal();render();toast(t('deal_saved',{p:b.dataset.dp}))});
}
function wishDeal(e){
  const v=entryValue(e);if(v==null)return null;
  const h0=e.hist?.find(x=>x.v>0)?.v;const pct=h0&&e.hist.length>1?(v-h0)/h0*100:0;
  const hit=e.alert?.dir==='below'&&v<=e.alert.price;
  return hit||pct<=-(settings.dealPct||5)?{hit,pct}:null;
}
function entryTile(e,opts={}){
  const v=entryValue(e);
  // wishlist: change since the card was added (a drop is good news for a buyer → green); collection: gain vs purchase price
  const h0=e.hist?.find(x=>x.v>0)?.v;
  const ch=opts.wish?(h0&&v!=null&&e.hist.length>1?(v-h0)/h0*100:null):(e.buy>0&&v!=null?(v-e.buy)/e.buy*100:null);
  const good=opts.wish?ch<=0:ch>=0;
  const nCopies=opts.wish?1:copiesOf(e);
  return `<div class="tile ${opts.remove?'has-x':''} ${nCopies>1?'has-count':''}" data-uid="${e.uid}">
    ${nCopies>1?`<span class="badge" title="${esc(t('copies',{n:nCopies}))}">${nCopies}</span>`:''}<span class="lbadge">${FLAGS[e.lang]}</span>${multiGame()&&!gvActive()?`<span class="tgame">${gdot(gameOf(e))}</span>`:''}${opts.bell?`<button class="wbtn bbtn ${e.alert?'on':''} ${e.alert?.hit?'hit':''}" data-bell="${e.uid}" aria-label="${esc(t('alert_cfg'))}" title="${esc(e.alert?(e.alert.dir==='below'?'≤ ':'≥ ')+fmtEur(e.alert.price):t('alert_cfg'))}">${BELL}</button>`:''}${opts.remove?`<button class="wbtn xbtn" data-x="${e.uid}" aria-label="${esc(t('wish_remove'))}" title="${esc(t('wish_remove'))}">${XICON}</button>`:''}
    <div class="img">${imgTag(e.image,e.setId,e.localId,e.name,'low','',e.lang)}${e.grade?.co?`<span class="gbadge">${esc(gradeStr(e))}</span>`:''}</div>
    <div class="nm" title="${esc(e.name)}">${opts.wish?`<button class="prio ${e.prio?'on':''}" data-prio="${e.uid}" aria-pressed="${!!e.prio}" aria-label="${esc(t('prio'))}" title="${esc(t('prio'))}">${e.prio?'★':'☆'}</button>`:''}${e.alert&&!opts.bell?`<span title="${t('alert')}">🔔 </span>`:''}${esc(e.name)}</div>
    <div class="meta">${e.manualCard?`<span class="man-tag">${t('man_tag')}</span> `:''}${esc(e.setName||'')}${e.setName?' · ':''}${esc(numLabel(e.localId,e.official))}${e.variant&&e.variant!=='normal'?' · '+t('v_'+e.variant):''}</div>
    <div class="row"><span class="price">${(()=>{const ck=!(e.manual>0)&&!(e.myPrice?.v>0)&&priceCheck(e);return ck&&!ck.alt?`<span class="pchk" title="${esc(t('chk_tip'))}">⚠ ${t('chk_short')}</span>`:v!=null?fmtEur(!opts.wish&&(e.qty||1)>1?v*e.qty:v)+(!opts.wish&&(e.qty||1)>1&&!settings.hidePrices?` <span class="muted small">· ×${e.qty}</span>`:'')+(ck||(gameOf(e)!=='op'&&!(e.manual>0)&&!(e.myPrice?.v>0)&&tcpOnly(e))?` <span class="pchk-src" title="${esc(t(ck?'chk_tcp_tip':'tcp_only_tip'))}">TCGP</span>`:''):'<span class="muted small">'+t('price_unavailable')+'</span>'})()}${opts.wish&&(e.qty||1)>1?` <span class="muted small">×${e.qty}</span>`:''}</span><span class="small ${good?'pos':'neg'}" ${opts.wish&&ch!=null?`title="${esc(t('since_added'))}"`:''}>${ch!=null&&Math.abs(ch)>=0.05?fmtPct(ch):''}</span></div>
  </div>`;
}
/* ============ wishlist sharing: public link (Supabase table shared_wishlists, see supabase/share.sql) ============ */
const shareUrl=tok=>APP_URL+'?w='+tok;
function wishSnapshot(){
  return collection.filter(e=>e.status==='wish').sort((a,b)=>(b.prio?1:0)-(a.prio?1:0)||(entryValue(b)||0)-(entryValue(a)||0)).slice(0,300)
    .map(e=>({n:e.name,s:e.setName||'',sid:e.setId||'',l:String(e.localId||''),o:e.official||null,i:e.image||'',g:e.lang,p:e.prio?1:0,q:e.qty||1,v:entryValue(e)!=null?Math.round(entryValue(e)*100)/100:null}));
}
async function shareGet(){const{data,error}=await sb.from('shared_wishlists').select('token,show_prices').eq('user_id',user.id).maybeSingle();if(error)throw error;return data}
async function sharePush(prices){
  if(!sb||!user)return null;
  const row={user_id:user.id,data:wishSnapshot(),updated_at:new Date().toISOString()};if(prices!=null)row.show_prices=prices;
  const{data,error}=await sb.from('shared_wishlists').upsert(row,{onConflict:'user_id'}).select('token,show_prices').single();
  if(error)throw error;return data;
}
const SHARE_LOGO=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#14213D"/><g transform="translate(251 266) scale(1.15) translate(-251 -266)"><g transform="rotate(-16 256 280)"><rect x="166" y="140" width="180" height="252" rx="20" fill="#2B4170"/></g><g transform="rotate(-4 256 280)"><rect x="166" y="140" width="180" height="252" rx="20" fill="#41639E"/></g><g transform="rotate(10 256 280)"><rect x="166" y="140" width="180" height="252" rx="20" fill="#F6F2EA"/><rect x="180" y="154" width="152" height="224" rx="12" fill="none" stroke="#14213D" stroke-opacity="0.15" stroke-width="3"/><g class="star"><g transform="translate(256 214)"><polygon points="0,-30 7.64,-10.52 28.53,-9.27 12.36,4.02 17.63,24.27 0,13 -17.63,24.27 -12.36,4.02 -28.53,-9.27 -7.64,-10.52" fill="#F5A524" stroke="#F5A524" stroke-width="6" stroke-linejoin="round"/></g></g><polyline points="196,342 224,312 252,330 306,276" fill="none" stroke="#14213D" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><polyline points="280,276 306,276 306,302" fill="none" stroke="#14213D" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></g></g><g class="sp1"><g transform="translate(408 118)"><path d="M0,-34 C4,-10 10,-4 34,0 C10,4 4,10 0,34 C-4,10 -10,4 -34,0 C-10,-4 -4,-10 0,-34 Z" fill="#F5A524"/></g></g><g class="sp2"><g transform="translate(446 170)"><path d="M0,-15 C2,-4 4,-2 15,0 C4,2 2,4 0,15 C-2,4 -4,2 -15,0 C-4,-2 -2,-4 0,-15 Z" fill="#F6F2EA"/></g></g><g class="dial"><g transform="translate(372 396)"><circle r="54" fill="#F5A524" stroke="#14213D" stroke-width="10"/><circle r="34" fill="#14213D"/><g stroke="#F5A524" stroke-width="7" stroke-linecap="round"><line x1="0" y1="0" x2="0" y2="-22"/><line x1="0" y1="0" x2="19" y2="11"/><line x1="0" y1="0" x2="-19" y2="11"/></g><circle r="8" fill="#F5A524"/><g fill="#14213D"><circle cx="0" cy="-44" r="3.5"/><circle cx="44" cy="0" r="3.5"/><circle cx="0" cy="44" r="3.5"/><circle cx="-44" cy="0" r="3.5"/></g></g></g></svg>`;
// share image: drawn on a canvas (1080 px wide, portrait), 8 cards max then "+N"
function loadImg(srcs){return new Promise(res=>{let i=0;const next=()=>{if(i>=srcs.length)return res(null);const im=new Image();im.crossOrigin='anonymous';im.onload=()=>res(im);im.onerror=next;im.src=srcs[i++]};next()})}
const wishSorted=()=>collection.filter(e=>e.status==='wish').sort((a,b)=>(b.prio?1:0)-(a.prio?1:0)||(entryValue(b)||0)-(entryValue(a)||0));
// cards chosen for the share image (settings.shareSel = uids), or the whole wishlist when nothing is chosen
const shareList=()=>{const all=wishSorted(),sel=settings.shareSel;if(!sel?.length)return all;const k=all.filter(e=>sel.includes(e.uid));return k.length?k:all};
async function makeWishImage(prices,withArt=true){
  const list=shareList();
  const n=list.reduce((a,e)=>a+(e.qty||1),0),tot=list.reduce((a,e)=>a+(entryValue(e)||0)*(e.qty||1),0);
  const show=list.length>9?list.slice(0,8):list.slice(0,9),more=list.length-show.length;
  const W=1080,P=60,G=26,cols=3,cw=(W-2*P-G*(cols-1))/cols,ch=cw*88/63,th=prices?92:84,rows=Math.ceil((show.length+(more?1:0))/cols);
  const H=Math.round(P+120+70+rows*(ch+th)+(rows-1)*G+60+P);
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
  try{await document.fonts?.ready}catch(_){}
  const F='Outfit, system-ui, -apple-system, Segoe UI, sans-serif';
  const bg=x.createRadialGradient(W/2,0,0,W/2,0,H*.9);bg.addColorStop(0,'#1d2d55');bg.addColorStop(.45,'#14213D');bg.addColorStop(1,'#0b1226');x.fillStyle=bg;x.fillRect(0,0,W,H);
  const rr=(X,Y,w,h,r)=>{x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath()};
  const fit=(txt,max)=>{if(x.measureText(txt).width<=max)return txt;while(txt.length>1&&x.measureText(txt+'…').width>max)txt=txt.slice(0,-1);return txt+'…'};
  const logo=await loadImg(['data:image/svg+xml;charset=utf-8,'+encodeURIComponent(SHARE_LOGO)]);
  if(logo){x.save();rr(P,P,96,96,22);x.clip();x.drawImage(logo,P,P,96,96);x.restore()}
  x.fillStyle='#fff';x.font=`700 54px ${F}`;x.textBaseline='alphabetic';x.fillText(t('share_img_t'),P+122,P+52);
  x.fillStyle='#aab4cc';x.font=`400 27px ${F}`;x.fillText('Gleamvault · '+fmtDate(new Date()),P+122,P+92);
  let y=P+120+46;x.font=`400 30px ${F}`;x.fillStyle='#c9d2e6';x.fillText(t('wish_count',{n}),P,y);
  if(prices&&tot){x.textAlign='right';x.font=`700 36px ${F}`;x.fillStyle='#FFC81E';const tv=fmtEur(tot)||'';x.fillText(tv,W-P,y);const tw=x.measureText(tv).width;x.font=`400 30px ${F}`;x.fillStyle='#c9d2e6';x.fillText(t('shared_budget')+' ',W-P-tw,y);x.textAlign='left'}
  y=P+120+70;
  const arts=withArt?await Promise.all(show.map(e=>loadImg(imgCandidates(e.image,e.setId,e.localId,'high',e.lang)))):[];
  show.forEach((e,i)=>{
    const cx=P+(i%cols)*(cw+G),cy=y+Math.floor(i/cols)*(ch+th+G);
    x.save();x.shadowColor='rgba(0,0,0,.4)';x.shadowBlur=24;x.shadowOffsetY=10;rr(cx,cy,cw,ch,16);x.fillStyle='#24304f';x.fill();x.restore();
    if(arts[i]){x.save();rr(cx,cy,cw,ch,16);x.clip();x.drawImage(arts[i],cx,cy,cw,ch);x.restore()}
    else{x.fillStyle='#aab4cc';x.font=`600 24px ${F}`;x.textAlign='center';x.fillText(fit(e.name,cw-30),cx+cw/2,cy+ch/2);x.textAlign='left'}
    if(e.prio){x.beginPath();x.arc(cx+30,cy+30,20,0,7);x.fillStyle='#FFC81E';x.fill();x.fillStyle='#1a1d24';x.font=`700 24px ${F}`;x.textAlign='center';x.fillText('★',cx+30,cy+39);x.textAlign='left'}
    if((e.qty||1)>1){x.beginPath();x.arc(cx+cw-30,cy+30,20,0,7);x.fillStyle='rgba(0,0,0,.65)';x.fill();x.fillStyle='#fff';x.font=`700 22px ${F}`;x.textAlign='center';x.fillText('×'+e.qty,cx+cw-30,cy+38);x.textAlign='left'}
    x.fillStyle='#fff';x.font=`700 27px ${F}`;x.fillText(fit(e.name,cw),cx,cy+ch+36);
    const v=entryValue(e),pv=prices&&v!=null?fmtEur(v):'';
    x.font=`700 24px ${F}`;const pw=pv?x.measureText(pv).width+10:0;
    x.fillStyle='#aab4cc';x.font=`400 22px ${F}`;x.fillText(fit((e.setName?e.setName+' · ':'')+numLabel(e.localId,e.official),cw-pw),cx,cy+ch+68);
    if(pv){x.fillStyle='#fff';x.font=`700 24px ${F}`;x.textAlign='right';x.fillText(pv,cx+cw,cy+ch+68);x.textAlign='left'}
  });
  if(more){const i=show.length,cx=P+(i%cols)*(cw+G),cy=y+Math.floor(i/cols)*(ch+th+G);x.setLineDash([12,10]);x.lineWidth=3;x.strokeStyle='#3a4a75';rr(cx+2,cy+2,cw-4,ch-4,16);x.stroke();x.setLineDash([]);x.fillStyle='#c9d2e6';x.font=`700 52px ${F}`;x.textAlign='center';x.fillText('+'+more,cx+cw/2,cy+ch/2+18);x.textAlign='left'}
  x.fillStyle='#8592ad';x.font=`400 23px ${F}`;x.fillText(list.some(e=>e.prio)?'★ '+t('share_img_prio'):'',P,H-P);x.textAlign='right';x.fillText(prices?t('share_img_src'):t('share_img_made'),W-P,H-P);x.textAlign='left';
  return new Promise((res,rej)=>{try{cv.toBlob(b=>b?res(b):rej(new Error('blob')),'image/png')}catch(err){rej(err)}});
}
async function wishImageBlob(prices){try{return await makeWishImage(prices,true)}catch(_){return makeWishImage(prices,false)}} // card art from another site may block export: then without art
async function openShareSheet(tab='img'){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 10px 0">${t('share_t')}</h2>
    <div class="ev-seg" style="margin-bottom:14px"><button type="button" data-tab="img" class="${tab==='img'?'on':''}">🖼 ${t('share_tab_img')}</button><button type="button" data-tab="link" class="${tab==='link'?'on':''}">🔗 ${t('share_tab_link')}</button></div>
    <div id="shBody"><p class="muted"><span class="spin"></span></p></div></div>`,'sm');
  m.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.tab!==tab)openShareSheet(b.dataset.tab)});
  const body=m.querySelector('#shBody');
  if(tab==='img'){
    let prices=!!settings.shareImgPrices&&!settings.hidePrices,blob=null,url='';
    const drawImg=async()=>{
      const nSel=settings.shareSel?.length?shareList().length:0;
      body.innerHTML=`<div class="sh-imgbox"><span class="spin"></span></div>
        <div class="s-line"><span>${nSel?t('share_sel_n',{n:nSel}):t('share_sel_all')}</span><button type="button" class="btn btn-sm" id="shPick">${t('share_pick')}</button></div>
        ${settings.hidePrices?'':`<label class="s-line"><span>${t('share_prices')}</span><input type="checkbox" id="shIP" ${prices?'checked':''}></label>`}
        <button class="btn primary" id="shImgGo" style="width:100%;margin-top:12px" disabled>↗ ${t('share_img_send')}</button>`;
      const sip=m.querySelector('#shIP');if(sip)sip.onchange=e=>{prices=e.target.checked;settings.shareImgPrices=prices;saveSettings();drawImg()};
      m.querySelector('#shPick').onclick=()=>{
        const all=wishSorted();let sel=new Set((settings.shareSel?.length?shareList():all.slice(0,all.length>9?8:9)).map(e=>e.uid));
        const drawPick=()=>{body.innerHTML=`<p class="muted small" style="margin:0 0 8px">${t('share_pick_d')}</p>
          <div class="sh-pick">${all.map(e=>`<button type="button" class="sh-pc ${sel.has(e.uid)?'on':''}" data-u="${e.uid}" aria-pressed="${sel.has(e.uid)}" title="${esc(e.name)}">${imgTag(e.image,e.setId,e.localId,e.name,'low','',e.lang)}<span class="sh-ck">✓</span>${e.prio?'<span class="sh-pr">★</span>':''}<span class="sh-pn">${esc(e.name)}</span></button>`).join('')}</div>
          <div class="sh-pbar"><button type="button" class="linkbtn" id="shAll">${t('share_pick_auto')}</button><span class="muted small" id="shCnt"></span><button type="button" class="btn primary btn-sm" id="shOk">${t('share_pick_ok')}</button></div>`;
          const cnt=()=>{body.querySelector('#shCnt').textContent=t('share_sel_n',{n:sel.size})+(sel.size>9?' · '+t('share_pick_more'):'');body.querySelector('#shOk').disabled=!sel.size};cnt();
          body.querySelectorAll('.sh-pc').forEach(c=>c.onclick=()=>{const u=c.dataset.u;sel.has(u)?sel.delete(u):sel.add(u);c.classList.toggle('on',sel.has(u));c.setAttribute('aria-pressed',sel.has(u));cnt()});
          body.querySelector('#shAll').onclick=()=>{settings.shareSel=null;saveSettings();drawImg()};
          body.querySelector('#shOk').onclick=()=>{settings.shareSel=[...sel];saveSettings();drawImg()};};
        drawPick();
      };
      blob=await wishImageBlob(prices);if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
      const ib=body.querySelector('.sh-imgbox');if(!ib)return;ib.innerHTML=`<img src="${url}" alt="">`;
      const go=m.querySelector('#shImgGo');go.disabled=false;
      go.onclick=async()=>{const file=new File([blob],'wishlist-gleamvault.png',{type:'image/png'});
        if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:t('share_title')})}catch(_){}}
        else{const a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();toast(t('share_img_dl'))}};
    };
    drawImg();return;
  }
  body.insertAdjacentHTML('afterend',`<button class="linkbtn" id="shPrev" style="margin-top:14px">👁 ${t('share_prev')}</button>`);
  const pv=m.querySelector('#shPrev');if(pv)pv.onclick=()=>{closeModal();const snap=wishSnapshot();setTimeout(()=>viewShared(document.getElementById('main'),{cards:settings.shareLinkPrices?snap:snap.map(c=>({...c,v:null})),prices:!!settings.shareLinkPrices,updated:new Date().toISOString()}),250)};
  if(!user||!sb){body.innerHTML=`<p class="muted">${t('share_need_acc')}</p><button class="btn primary" id="shAcc">${t('tour_acc')}</button>`;m.querySelector('#shAcc').onclick=()=>{closeModal();openAccount()};return}
  let row=null;
  const draw=()=>{
    if(!row){body.innerHTML=`<p class="muted">${t('share_link_d')}</p>
      ${settings.hidePrices?'':`<label class="s-line"><span>${t('share_prices')}</span><input type="checkbox" id="shPr"></label>`}
      <button class="btn primary" id="shMake" style="width:100%;margin-top:12px">🔗 ${t('share_make')}</button>`;
      m.querySelector('#shMake').onclick=async ev=>{ev.target.disabled=true;try{row=await sharePush(m.querySelector('#shPr')?.checked??false);settings.shareOn=user.id;settings.shareLinkPrices=!!row?.show_prices;saveSettings();draw()}catch(e){console.warn(e);body.insertAdjacentHTML('beforeend',`<p class="neg small">${t('share_err')}</p>`);ev.target.disabled=false}};
      return}
    const url=shareUrl(row.token);
    body.innerHTML=`<p class="muted small" style="margin:0 0 8px">${t('share_live')}</p>
      <div class="sh-url"><input type="text" readonly value="${esc(url)}" id="shUrl"><button class="btn btn-sm" id="shCopy">${t('copy')}</button></div>
      ${navigator.share?`<button class="btn primary" id="shSend" style="width:100%;margin-top:10px">↗ ${t('share_send')}</button>`:''}
      ${settings.hidePrices?'':`<label class="s-line"><span>${t('share_prices')}</span><input type="checkbox" id="shPr" ${row.show_prices?'checked':''}></label>`}
      <button class="linkbtn neg" id="shOff" style="margin-top:12px">${t('share_off')}</button>`;
    m.querySelector('#shUrl').onfocus=e=>e.target.select();
    m.querySelector('#shCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast(t('copied'))}catch(_){m.querySelector('#shUrl').select()}};
    const sd=m.querySelector('#shSend');if(sd)sd.onclick=()=>navigator.share({title:t('share_title'),url}).catch(()=>{});
    const spr=m.querySelector('#shPr');if(spr)spr.onchange=async e=>{try{row=await sharePush(e.target.checked);settings.shareLinkPrices=!!row?.show_prices;saveSettings()}catch(_){toast(t('err_net'))}};
    m.querySelector('#shOff').onclick=async()=>{if(!await confirmBox(t('share_off_q')))return;try{const{error}=await sb.from('shared_wishlists').delete().eq('user_id',user.id);if(error)throw error;row=null;settings.shareOn=false;settings.shareLinkPrices=false;saveSettings();openShareSheet()}catch(_){toast(t('err_net'))}};
  };
  try{row=await shareGet();if(row){settings.shareOn=user.id;settings.shareLinkPrices=!!row.show_prices;saveSettings();sharePush().catch(()=>{})}draw()}
  catch(e){console.warn(e);body.innerHTML=`<p class="muted">${t('share_unavail')}</p>`}
}
async function viewShared(m,local){
  m.innerHTML=`<div class="shared"><p class="muted"><span class="spin"></span></p></div>`;
  let res=local||null;
  if(!res)try{if(!sb&&sbReady)await sbReady;if(!sb)throw 0;const{data,error}=await sb.rpc('get_shared_wishlist',{p_token:SHARED_TOKEN});if(error)throw error;res=data}catch(e){console.warn(e)}
  const box=m.querySelector('.shared');if(!box)return;
  if(local)box.insertAdjacentHTML('beforebegin',`<div class="man-ban"><span>👁 ${t('share_prev_ban')}</span><a class="btn btn-sm" href="#wishlist" id="shPrevBack">${t('share_prev_back')}</a></div>`);
  const pb=m.querySelector('#shPrevBack');if(pb)pb.onclick=ev=>{ev.preventDefault();location.hash='#wishlist';render()};
  if(!res){box.innerHTML=`<h1>${t('shared_t')}</h1><p class="muted">${t('shared_gone')}</p><a class="btn primary" href="${esc(APP_URL)}">${t('shared_cta')}</a>`;return}
  // the shared data was written by someone else: numbers forced to numbers, codes to safe values, pictures to known hosts
  const IMG_OK=/^https:\/\/(assets\.tcgdex\.net|cards\.scryfall\.io|images\.scrydex\.com|optcgapi\.com|www\.optcgapi\.com|en\.onepiece-cardgame\.com)\//;
  const cards=(Array.isArray(res.cards)?res.cards:[]).filter(c=>c&&typeof c==='object').map(c=>({q:Math.min(9999,Math.max(1,parseInt(c.q)||1)),v:Number.isFinite(+c.v)&&c.v!=null&&c.v!==''?+c.v:null,
    g:['fr','en','ja'].includes(c.g)?c.g:'',i:typeof c.i==='string'&&IMG_OK.test(c.i)?safeId(c.i):'',sid:safeId(c.sid),l:safeId(c.l),o:safeId(c.o),n:String(c.n??''),s:String(c.s??''),p:!!c.p}));
  const n=cards.reduce((a,c)=>a+c.q,0),tot=res.prices?cards.reduce((a,c)=>a+(c.v||0)*c.q,0):0;
  box.innerHTML=`<h1>${t('shared_t')}</h1>
    <p class="muted" style="margin:-6px 0 14px">${t('wish_count',{n})}${res.prices&&tot&&!settings.hidePrices?` · ${t('shared_budget')} <b style="color:var(--text)">${fmtEur(tot)}</b>`:''}${res.updated?` · ${t('shared_upd',{d:esc(fmtDate(res.updated))})}`:''}</p>
    <div class="grid">${cards.map(c=>`<div class="tile"><span class="lbadge">${FLAGS[c.g]||''}</span>${c.q>1?`<span class="badge">${c.q}</span>`:''}
      <div class="img">${imgTag(c.i,c.sid,c.l,c.n,'low','',c.g)}</div>
      <div class="nm">${c.p?'<span class="prio on">★</span>':''}${esc(c.n)}</div>
      <div class="meta">${esc(c.s)}${c.s?' · ':''}${esc(numLabel(c.l,c.o))}</div>
      ${res.prices&&c.v!=null?`<div class="row"><span class="price">${fmtEur(c.v)}</span></div>`:''}</div>`).join('')}</div>
    <div class="shared-cta"><p class="muted">${t('shared_made')}</p><a class="btn primary" href="${esc(APP_URL)}">${t('shared_cta')}</a></div>`;
}
/* ============ view: add / search ============ */
const search={q:'',set:'',page:1};
let afOpen=false;
const addGame=()=>GAMES[settings.game]?settings.game:'pk';
const gamePicker=()=>gameOn()?`<button type="button" class="gsel" id="gSel" title="${esc(t('game_pick'))}" aria-haspopup="menu" aria-expanded="false">${gdot(addGame())}<span>${GAMES[addGame()].n}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>`:'';
function bindGamePicker(m){
  const b=m.querySelector('#gSel');if(!b)return;
  b.onclick=()=>{if(document.querySelector('.gv-pop')){closeMenu();return}
    const cur=addGame();
    openMenuAt(b,Object.keys(GAMES).map(g=>`<button type="button" class="g-opt ${g===cur?'on':''}" data-game="${g}" role="menuitemradio" aria-checked="${g===cur}">${gdot(g)}<span>${GAMES[g].n}</span><small>${t('n_cards',{n:collection.filter(e=>gameOf(e)===g&&e.status!=='wish').reduce((a,e)=>a+(e.qty||1),0)})}</small></button>`).join(''),
      x=>{if(x.dataset.game!==cur){settings.game=x.dataset.game;saveSettings();render()}})};
}
// small menu anchored under (or above) a button, closed by a tap outside, Escape, scrolling or changing tab
function openMenuAt(anchor,html,onPick,minW){
  closeMenu();
  const r=anchor.getBoundingClientRect(),pop=document.createElement('div');
  pop.className='gv-pop';pop.setAttribute('role','menu');pop.innerHTML=html;document.body.appendChild(pop);
  const w=Math.min(Math.max(minW||0,280),innerWidth-24);pop.style.width=w+'px';pop.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+'px';
  const room=Math.max(innerHeight-r.bottom,r.top)-24;pop.style.maxHeight=Math.min(room,innerHeight*.6)+'px';
  const below=innerHeight-r.bottom>=Math.min(pop.offsetHeight,innerHeight*.6)+16||innerHeight-r.bottom>=r.top;pop.style.top=(below?r.bottom+6:Math.max(12,r.top-pop.offsetHeight-6))+'px';
  anchor.setAttribute('aria-expanded','true');menuAnchor=anchor;
  pop.querySelectorAll('.g-opt').forEach(x=>x.onclick=()=>{closeMenu();onPick(x)});
  setTimeout(()=>{document.addEventListener('pointerdown',menuOut,true);document.getElementById('main').addEventListener('scroll',closeMenu,{once:true,passive:true});addEventListener('scroll',closeMenu,{once:true,passive:true});addEventListener('resize',closeMenu,{once:true});addEventListener('hashchange',closeMenu,{once:true});document.addEventListener('keydown',menuKey)},0);
  const on=pop.querySelector('.g-opt.on');if(on){on.focus({preventScroll:true});if(on.offsetTop>pop.clientHeight-40)pop.scrollTop=on.offsetTop-pop.clientHeight/2}
}
let menuAnchor=null;
document.addEventListener('mousedown',ev=>{
  const sel=ev.target.closest?.('select');if(!sel||sel.disabled||ev.button!==0||!matchMedia('(pointer:fine)').matches)return;
  ev.preventDefault();
  if(menuAnchor===sel){closeMenu();return}
  sel.focus({preventScroll:true});
  const opts=[...sel.options].map((o,i)=>o.disabled||o.hidden?'':`<button type="button" class="g-opt dd-opt ${o.selected?'on':''}" data-i="${i}" role="menuitemradio" aria-checked="${o.selected}"><span>${esc(o.textContent)}</span></button>`).join('');
  openMenuAt(sel,opts,x=>{const i=+x.dataset.i;if(sel.selectedIndex!==i){sel.selectedIndex=i;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}))}sel.focus({preventScroll:true})},sel.getBoundingClientRect().width);
},true);
function menuOut(e){if(!e.target.closest('.gv-pop')&&!(menuAnchor&&menuAnchor.contains(e.target)))closeMenu()}
function menuKey(e){if(e.key==='Escape')closeMenu()}
function closeMenu(){const p=document.querySelector('.gv-pop');if(!p)return;p.remove();document.removeEventListener('pointerdown',menuOut,true);document.removeEventListener('keydown',menuKey);menuAnchor?.setAttribute('aria-expanded','false');menuAnchor=null}
function searchEase(inp,onClear){
  const box=inp.closest('.searchbox'),clr=box?.querySelector('.sclear');
  const upd=()=>{if(clr)clr.hidden=!inp.value};upd();
  inp.addEventListener('input',upd);
  inp.addEventListener('focus',()=>{if(inp.value)setTimeout(()=>{try{inp.setSelectionRange(0,inp.value.length)}catch(_){inp.select()}},0)});
  if(clr)clr.onclick=ev=>{ev.preventDefault();inp.value='';upd();onClear();inp.focus()};
}
let mgSearch={q:'',set:'',rar:'',special:false,sort:'new',res:null,next:null,total:0};let mgOpen=false;
// Scryfall sets (paper only), cached on the device for a day
let mgSets=null;
async function loadMgSets(){
  if(mgSets)return mgSets;
  const c=LS.get('pf_mgsets',null);if(obj(c)&&Array.isArray(c.sets)&&Date.now()-c.ts<864e5){mgSets=c.sets.filter(obj);return mgSets}
  const j=await scryJSON(`${SCRY}/sets`);
  const KEEP=new Set(['core','expansion','masters','draft_innovation','commander','funny','starter','box','from_the_vault','spellbook','premium_deck','duel_deck','arsenal','promo']);
  mgSets=(j.data||[]).filter(x=>!x.digital&&KEEP.has(x.set_type)&&(x.card_count||0)>0).map(x=>({c:x.code,n:x.name,d:x.released_at||'',t:x.set_type,k:x.card_count,i:x.icon_svg_uri||''}))
    .sort((a,b)=>b.d.localeCompare(a.d));
  LS.set('pf_mgsets',{ts:Date.now(),sets:mgSets});return mgSets;
}
const MG_SPECIAL='(border:borderless OR frame:showcase OR frame:extendedart OR (is:full -t:basic))';   // documented Scryfall keywords (docs/syntax); numbered cards are almost always borderless or showcase
const MG_LANG={EN:'en',FR:'fr',DE:'de',IT:'it',ES:'es',SP:'es',PT:'pt',JA:'ja',JP:'ja',KO:'ko',KR:'ko',RU:'ru',CS:'zhs',CT:'zht'};
function parseMgFoot(texts){
  let set=null,lng=null,num=null;
  for(const tx of texts){
    const T=tx.toUpperCase().replace(/[|]/g,'I');
    const m=/\b([A-Z0-9]{3,5})\s*[•·.*\-]?\s*(EN|FR|DE|IT|ES|SP|PT|JA|JP|KO|KR|RU|CS|CT)\b/.exec(T);
    if(m&&!set&&/[A-Z]/.test(m[1])){set=m[1];lng=MG_LANG[m[2]]}
    const n=/\b0*(\d{1,4})(?:\s*\/\s*\d{2,4})?\s+[CURMSLT]\b|\b[CURMSLT]\s+0*(\d{1,4})\b|\b0*(\d{1,4})\s*\/\s*\d{2,4}\b/.exec(T);
    if(n&&!num)num=n[1]||n[2]||n[3];
  }
  return{set,lng,num};
}
async function scanMagic(file,lang,apply){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 12px 0">📷 ${t('scan_title')}</h2>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start"><img id="scanPrev" alt="" style="width:150px;border-radius:10px;background:var(--card2)">
    <div style="flex:1;min-width:180px"><p id="scanStatus"><span class="spin"></span> ${t('scan_loading')}</p><div id="scanOut" class="small"></div></div></div></div>`,'sm');
  const st=m.querySelector('#scanStatus'),outEl=m.querySelector('#scanOut');
  let img;try{img=await fileToImage(file);m.querySelector('#scanPrev').src=img.src}catch(e){st.textContent=t('import_bad');return}
  const rec=recognize(img,'mg').catch(()=>null);   // one fingerprint per artwork (Scryfall « unique artwork »)
  try{
    const w=await getOcr(lang);
    st.innerHTML=`<span class="spin"></span> ${t('scan_reading')}`;
    await w.setParameters({tessedit_char_whitelist:'0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ•.- '});
    const texts=[];let foot={};
    for(const flt of['grayscale(1) contrast(1.7)','grayscale(1) invert(1) contrast(2.2)','grayscale(1) contrast(3) brightness(1.2)']){
      for(const[y0,y1]of[[0.9,0.985],[0.86,0.95]]){texts.push((await w.recognize(cropCanvas(img,0,0.55,y0,y1,4,flt))).data.text);foot=parseMgFoot(texts);if(foot.set&&foot.num)break}
      if(foot.set&&foot.num)break;
      st.innerHTML=`<span class="spin"></span> ${t('scan_retry')}`;
    }
    await w.setParameters({tessedit_char_whitelist:''});
    // 1) set + number (+ language): exact printing
    if(foot.set&&foot.num){
      const code=foot.set.toLowerCase(),L=foot.lng||lang;
      let c=null;
      for(const u of[`${SCRY}/cards/${code}/${foot.num}/${L}`,`${SCRY}/cards/${code}/${foot.num}`]){try{c=await getJSON(u);break}catch(_){}}
      if(c&&c.lang!==L&&L!=='en'){try{const r=await scryJSON(`${SCRY}/cards/search?q=${encodeURIComponent(`e:${code} cn:${foot.num} lang:${L}`)}&unique=prints`);if(r.data?.[0])c=r.data[0]}catch(_){}}
      if(c){closeModal();const cl=GAMES.mg.langs.includes(c.lang)?c.lang:lang;openCard(cl,'mg:'+c.id);return}
    }
    // 2) the picture: artwork recognised → its printings (set code / number read on the card decide, else the user picks)
    const top=(await w.recognize(cropCanvas(img,0.04,0.75,0.03,0.115,2))).data.text.replace(/[^\p{L}' ,\-]/gu,' ').replace(/\s+/g,' ').trim();
    const r=await rec;
    if(r&&r.length&&await mgRecognised(m,st,outEl,r,foot,lang,top,apply))return;
    // 3) the name at the top of the card: put it in the search
    // only a real word (3 letters in a row): reader noise like « a , xq » must not end up in the search
    if(/\p{L}{3,}/u.test(top)){closeModal();apply(top);toast(t('scan_mg_name',{q:top}));return}
    st.innerHTML=`<b>${t('scan_fail')}</b>`;
    outEl.innerHTML='';scanHelp(outEl,'scan_mg_tips','mScan');
  }catch(e){
    // text reading unavailable (offline engine, error): the picture alone can still find the card
    const r=await rec;if(r&&r.length&&await mgRecognised(m,st,outEl,r,{},lang,'',apply))return;
    st.innerHTML=`<b>${t('scan_fail')}</b>`;outEl.textContent=t('err_net')}
}
// Magic picture recognition: candidates are artworks (one Scryfall card each); a sure match goes straight to its printings
async function mgCards(ids){
  try{const r=await fetch(`${SCRY}/cards/collection`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({identifiers:ids.map(id=>({id}))})});
    if(!r.ok)throw 0;return (await r.json()).data||[]}catch(_){return[]}
}
async function mgArtPrints(c){   // every paper printing sharing this artwork, newest first
  try{const j=await scryJSON(c.prints_search_uri);return (j.data||[]).filter(x=>x.illustration_id===c.illustration_id&&(x.games||[]).includes('paper')).sort((a,b)=>String(b.released_at).localeCompare(String(a.released_at)))}catch(_){return[c]}
}
async function mgOpenPrint(c,lang){   // the printing in the language of the cards when it exists (else English, as the search does)
  if(lang&&lang!=='en'&&c.lang!==lang){try{const x=await scryJSON(`${SCRY}/cards/${c.set}/${encodeURIComponent(c.collector_number)}/${lang}`);if(x&&x.id)c=x}catch(_){}}
  closeModal();openCard(GAMES.mg.langs.includes(c.lang)?c.lang:'en','mg:'+c.id);
}
async function mgRecognised(m,st,outEl,r,foot,lang,top,apply){
  const cards=await mgCards(r.map(x=>x.id));if(!cards.length)return false;
  const byId=Object.fromEntries(cards.map(c=>[c.id,c]));
  const choosePrint=async c=>{
    st.innerHTML=`<span class="spin"></span> ${t('scan_reading')}`;
    let pr=await mgArtPrints(c);
    // what was read at the bottom of the card narrows it down (set code, number)
    const code=(foot.set||'').toLowerCase();
    const hit=pr.filter(x=>(code&&x.set===code)||(foot.num&&x.collector_number===String(foot.num)));
    if(hit.length===1||pr.length===1)return mgOpenPrint(hit[0]||pr[0],lang);
    if(hit.length>1)pr=hit;
    st.innerHTML=`<b>${t('scan_mg_prints')}</b>`;outEl.innerHTML='';
    showRec(outEl,pr.slice(0,12).map(x=>({id:x.id,s:null})),id=>{const x=pr.find(p=>p.id===id);return x&&{n:x.printed_name||x.name,i:mgImg(x,'normal'),sn:mgSetName(x.set,x.set_name),l:x.collector_number,st:'',lang:''}},id=>mgOpenPrint(pr.find(p=>p.id===id),lang));
    outEl.querySelector('.rec b')?.remove();outEl.querySelector('.rec .muted')?.remove();   // the status line above already says what to do
  };
  if(recSure(r)&&byId[r[0].id]){await choosePrint(byId[r[0].id]);return true}
  st.innerHTML=`<b>${t('scan_fail')}</b>`;outEl.innerHTML='';
  const ok=showRec(outEl,r,id=>{const c=byId[id];return c&&{n:c.printed_name||c.name,i:mgImg(c,'normal'),sn:mgSetName(c.set,c.set_name),l:c.collector_number,st:'',lang:''}},id=>byId[id]&&choosePrint(byId[id]));
  if(ok&&top.length>=3){outEl.insertAdjacentHTML('beforeend',`<p style="margin-top:10px"><button type="button" class="btn ghost small" id="mgByName">${t('scan_mg_byname',{q:esc(top)})}</button></p>`);outEl.querySelector('#mgByName').onclick=()=>{closeModal();apply(top)}}
  return ok;
}
function viewAddMagic(m){
  const lang=GAMES.mg.langs.includes(settings.mgLang)?settings.mgLang:(settings.lang==='fr'?'fr':'en');
  const S=mgSearch;
  const SRCH='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  m.innerHTML=`<h1 class="hide-m">${t('add_title')}</h1>
  <div class="add-top">${gamePicker()}<div class="seg langseg" role="group" aria-label="${esc(t('card_lang'))}">${GAMES.mg.langs.map(l=>`<button data-ml="${l}" class="${l===lang?'on':''}">${FLAGS[l]} ${LANG_NAMES[l]}</button>`).join('')}</div></div>
  <div class="cfilters afilters">
    <div class="cf-row">
      <div class="searchbox scanbox">${SRCH}<input maxlength="100" type="text" class="bigsearch" id="mq" placeholder="${esc(t('mg_ph'))}" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search"><button type="button" class="sclear" aria-label="${esc(t('clear_search'))}" title="${esc(t('clear_search'))}" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><label class="scanic" title="${esc(t('scan_btn'))}" aria-label="${esc(t('scan_btn'))}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg><input type="file" id="mScan" accept="image/*" hidden></label></div>
      <button type="button" class="btn cf-toggle ${mgOpen?'on':''}" id="mfToggle" aria-expanded="${mgOpen}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg><span class="cf-count" id="mfCount"></span></button>
    </div>
    <div class="cf-panel ${mgOpen?'open':''}" id="mfPanel">
      <select id="mset" aria-label="${t('set')}"><option value="">${t('all_sets')}</option></select>
      <select id="msort" aria-label="${t('sort_label')}">${[['new',t('ss_newest')],['old',t('ss_oldest')],['num_asc',t('ss_num_asc')],['num_desc',t('ss_num_desc')]].map(([k,l])=>`<option value="${k}" ${S.sort===k?'selected':''}>${l}</option>`).join('')}</select>
      <select id="mrar" aria-label="${t('rarity')}"><option value="">${t('mg_rar_all')}</option>${['mythic','rare','uncommon','common'].map(r=>`<option value="${r}" ${S.rar===r?'selected':''}>${MG_RAR[r][settings.lang==='fr'?0:1]}</option>`).join('')}</select>
      <button type="button" class="chip ${S.special?'on':''}" id="mspec" aria-pressed="${S.special}" title="${esc(t('mg_special_hint'))}">★ ${t('mg_special')}</button>
      <button type="button" class="linkbtn af-reset" id="mfReset">↺ ${t('f_reset')}</button>
    </div>
  </div>
  <div id="mres"></div>`;
  bindGamePicker(m);
  const res=m.querySelector('#mres'),mq=m.querySelector('#mq'),mset=m.querySelector('#mset');
  const nF=()=>(S.set?1:0)+(S.rar?1:0)+(S.special?1:0)+(S.sort!=='new'?1:0);
  const updCount=()=>{const n=nF(),c=m.querySelector('#mfCount');c.textContent=n||'';c.style.display=n?'':'none';m.querySelector('#mfReset').style.display=n?'':'none'};updCount();
  m.querySelectorAll('[data-ml]').forEach(b=>b.onclick=()=>{if(b.dataset.ml===lang)return;settings.mgLang=b.dataset.ml;saveSettings();S.res=null;render()});
  m.querySelector('#mfToggle').onclick=e=>{mgOpen=!mgOpen;m.querySelector('#mfPanel').classList.toggle('open',mgOpen);e.currentTarget.classList.toggle('on',mgOpen);e.currentTarget.setAttribute('aria-expanded',mgOpen)};
  if(matchMedia('(hover: hover) and (pointer: fine)').matches)setTimeout(()=>mq.focus(),30);
  const tileOf=x=>({c:{id:'mg:'+x.id,n:x.printed_name||x.card_faces?.[0]?.printed_name||x.name,l:x.collector_number,s:x.set,i:mgImg(x,'normal'),tag:mgTags(x).join(' · ')},st:{n:mgSetName(x.set,x.set_name),off:null}});
  const ready=()=>S.q.trim().length>=2||S.set;
  const home=async()=>{
    res.innerHTML=`<p class="muted small" style="margin:2px 0 14px">${t('mg_hint')}</p><div id="mhome"><span class="spin"></span></div><p class="muted small">${t('mg_src')}</p>`;
    try{const sets=(await loadMgSets()).filter(x=>['core','expansion','masters','draft_innovation','commander'].includes(x.t)&&x.d<=today()).slice(0,8);
      const h=res.querySelector('#mhome');if(!h)return;
      h.innerHTML=`<h3 class="ah-t">${t('ah_sets')}</h3><div class="ah-sets">${sets.map(x=>`<button class="ah-set" data-mset="${esc(x.c)}">${x.i?`<span class="ah-logo mg"><img src="${esc(x.i)}" alt="" loading="lazy" class="mg-sym" data-err="rmp"></span><img src="${esc(x.i)}" alt="" loading="lazy" class="mg-sym ah-sym" data-err="rm">`:''}<span>${esc(mgSetName(x.c,x.n))}</span><small class="muted">${t('n_cards',{n:x.k})}</small></button>`).join('')}</div>`;
      h.querySelectorAll('[data-mset]').forEach(b=>b.onclick=()=>{S.set=b.dataset.mset;mset.value=S.set;updCount();go()});
    }catch(_){const h=res.querySelector('#mhome');if(h)h.innerHTML=''}
  };
  const draw=()=>{
    if(!ready()){home();return}
    if(!S.res){res.innerHTML=`<p class="muted"><span class="spin"></span></p>`;return}
    if(!S.res.length){res.innerHTML=`<div class="empty small"><p>${t('mg_none')}</p>${nF()?`<button class="btn" id="mNoF">${t('nr_clear')}</button>`:''}</div>`;const nf=res.querySelector('#mNoF');if(nf)nf.onclick=()=>{S.set='';S.rar='';S.special=false;S.sort='new';render()};return}
    const rl=S.rlang||lang;
    res.innerHTML=`${rl!==lang?`<div class="man-ban"><span><span class="lflag">${FLAGS[rl]}</span>${t('mg_fallback')}</span></div>`:S.via?`<p class="muted small" style="margin:0 0 6px">${S.via.length===1?t('mg_via',{n:esc(S.via[0])}):t('mg_via_n',{q:esc(S.q.trim()),n:esc(S.via.slice(0,3).join(', '))+(S.via.length>3?' '+t('mg_via_more',{n:S.via.length-3}):'')})}</p>`:''}<p class="muted small">${t('results',{n:S.total||S.res.length})}</p><div class="grid" id="sgrid">${S.res.map(x=>resultTile(tileOf(x),rl)).join('')}</div>${S.next?`<div style="text-align:center;margin:14px 0"><button class="btn" id="mMore">${t('mg_more')}</button></div>`:''}`;
    bindTiles(res.querySelector('#sgrid'),rl);
    const mm=res.querySelector('#mMore');if(mm)mm.onclick=async()=>{mm.disabled=true;mm.innerHTML='<span class="spin"></span>';try{const r=await scryJSON(S.next);S.res.push(...r.data);S.next=r.has_more?r.next_page:null}catch(_){toast(t('err_net'))}draw()};
  };
  let timer,seq=0;
  const go=async()=>{
    S.q=mq.value;S.res=null;S.next=null;updCount();
    if(!ready()){draw();return}
    draw();const my=++seq;
    const [order,dir]={new:['released','desc'],old:['released','asc'],num_asc:['set','asc'],num_desc:['set','desc']}[S.sort]||['released','desc'];
    const ask=(L,name=S.q.trim())=>scryFetch(`${SCRY}/cards/search?q=${encodeURIComponent([name,S.set?`e:${S.set}`:'',S.rar?`r:${S.rar}`:'',S.special?MG_SPECIAL:'','game:paper',`lang:${L}`].filter(Boolean).join(' '))}&unique=prints&order=${order}&dir=${dir}`,()=>my!==seq);
    try{
      let r=await ask(lang);S.rlang=lang;S.via='';S.viaExact='';
      // a name typed in another language: find it among the cards of the other languages, then search the English (Oracle) name
      if(r.status===404&&/\p{L}/u.test(S.q)&&S.q.trim().length>=3){
        if(my===seq)res.innerHTML=`<p class="muted small mg-wait"><span class="spin"></span> ${t('mg_other_langs')}</p>`;   // Scryfall allows 2 searches/second: say what is taking time
        for(const L of GAMES.mg.langs.filter(x=>x!==lang)){
          try{const f=await scryFetch(`${SCRY}/cards/search?q=${encodeURIComponent([S.q.trim(),S.set?`e:${S.set}`:'',S.rar?`r:${S.rar}`:'',S.special?MG_SPECIAL:'','lang:'+L].filter(Boolean).join(' '))}&unique=cards`,()=>my!==seq);   // same filters as the search, so the names found are the right ones
            if(!f.ok)continue;
            // closest names first: printed name equal to what was typed (« Colère » → Anger), then starting with it, then containing it
            const qn=norm(S.q),rank=x=>{const pn=norm(x.printed_name||x.name);return pn===qn?0:pn.startsWith(qn)?1:2};
            const found=((await f.json()).data||[]).map(x=>({n:x.name,k:rank(x)})).sort((a,b)=>a.k-b.k);
            const names=[...new Set(found.map(x=>x.n))].slice(0,12);
            if(names.length){const r2=await ask(lang,'('+names.map(n=>`!"${n.replace(/"/g,'')}"`).join(' OR ')+')');if(r2.ok){r=r2;S.via=names;S.viaExact=found[0].k===0?found[0].n:''}break}
          }catch(_){}
        }
      }
      // many sets (and very recent ones) have no French printing listed on Scryfall: fall back on the English cards, with a note
      if(r.status===404&&lang!=='en'){r=await ask('en');S.rlang='en'}
      if(my!==seq||view!=='add')return;
      if(r.status===404){S.res=[];draw();return}
      if(!r.ok)throw new Error(r.status);
      const j=await r.json();S.res=j.data||[];if(S.viaExact)S.res.sort((a,b)=>(b.name===S.viaExact)-(a.name===S.viaExact));   // the card whose translated name is exactly what was typed comes first
      S.total=j.total_cards;S.next=j.has_more?j.next_page:null;
    }catch(_){if(my!==seq)return;res.innerHTML=`<div class="empty small"><p>${t('err_net')}</p></div>`;return}
    draw();
  };
  mq.oninput=()=>{clearTimeout(timer);timer=setTimeout(go,380)};
  searchEase(mq,()=>{clearTimeout(timer);go()});
  mq.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();clearTimeout(timer);go();mq.blur()}};
  m.querySelector('#mScan').onchange=ev=>{const f=ev.target.files[0];ev.target.value='';if(f)scanMagic(f,lang,q=>{mq.value=q;S.set='';mset.value='';go()})};
  mset.onchange=()=>{S.set=mset.value;go()};
  m.querySelector('#msort').onchange=e=>{S.sort=e.target.value;go()};
  m.querySelector('#mrar').onchange=e=>{S.rar=e.target.value;go()};
  m.querySelector('#mspec').onclick=e=>{S.special=!S.special;e.currentTarget.classList.toggle('on',S.special);e.currentTarget.setAttribute('aria-pressed',S.special);go()};
  m.querySelector('#mfReset').onclick=()=>{S.set='';S.rar='';S.special=false;S.sort='new';render()};
  loadMgSets().then(sets=>{if(!mset.isConnected)return;mset.innerHTML=`<option value="">${t('all_sets')}</option>`+sets.map(x=>`<option value="${esc(x.c)}" ${S.set===x.c?'selected':''}>${esc(mgSetName(x.c,x.n))} (${x.d.slice(0,4)})</option>`).join('')}).catch(()=>{});
  if(S.res&&S.q===mq.value)draw();else if(ready())go();else draw();
}
/* ============ One Piece (OPTCG API: English data, TCGplayer prices; every version — parallel, alternate art, manga — is its own card) ============ */
const OPAPI='https://optcgapi.com/api';
const OP_RAR={L:['Leader','Leader'],C:['Commune','Common'],UC:['Peu commune','Uncommon'],R:['Rare','Rare'],SR:['Super rare','Super rare'],SEC:['Secrète','Secret rare'],SP:['Spéciale','Special'],TR:['Trésor','Treasure rare'],P:['Promo','Promo']};
const opRar=r=>(OP_RAR[r]||[r,r])[settings.lang==='fr'?0:1];
const opVer=c=>{const n=c.n||'';return /\(Manga\)/i.test(n)?'manga':/\(Alternate Art\)/i.test(n)?'alt':/\(Parallel\)/i.test(n)?'par':/\((?:SP|Special)\)/i.test(n)?'sp':/_p\d/.test(c.i||'')&&c.s!=='PROMO'?'par':''};   // promo versions (_p1…) are stamps / events, not parallels
const opName=n=>String(n||'').replace(/\s*\((?:\d{3}|(?:OP|EB|ST|PRB)\d{2}-\d{3}|P-\d{3}|Parallel|Alternate Art|Manga|SP|Special)\)/gi,'').replace(/\s+/g,' ').trim();
// nicknames (French and English) → the name printed on the cards, so « Barbe Blanche » finds Edward Newgate
const OP_ALIAS=[[['barbe blanche','whitebeard','shirohige'],'edward newgate'],[['barbe noire','blackbeard','kurohige'],'marshall d teach'],[['big mom'],'charlotte linlin'],
  [['chapeau de paille','straw hat','mugiwara','nika','gear 5','gear five'],'monkey d luffy'],[['roux','red haired','red-haired','akagami'],'shanks'],[['poings ardents','fire fist','hiken'],'portgas d ace'],
  [['roi des pirates','pirate king'],'gol d roger'],[['oeil de faucon','œil de faucon','hawk eyes','hawkeyes'],'dracule mihawk'],[['chasseur de pirates','pirate hunter'],'roronoa zoro'],
  [['jambe noire','black leg'],'sanji'],[['chatte voleuse','cat burglar'],'nami'],[['roi des ames','roi des âmes','soul king'],'brook'],[['enfant du demon','enfant du démon','devil child'],'nico robin'],
  [['joker','dofla'],'donquixote doflamingo'],[['mr 0','mr. 0'],'crocodile'],[['chirurgien de la mort','surgeon of death'],'trafalgar law'],[['phenix','phénix','phoenix'],'marco'],
  [['akainu'],'sakazuki'],[['aokiji'],'kuzan'],[['kizaru'],'borsalino'],[['fujitora'],'issho'],[['ryokugyu'],'aramaki'],[['le heros','le héros','the hero'],'monkey d garp'],[['revolutionnaire','révolutionnaire','revolutionary'],'monkey d dragon'],
  [['sogeking','god usopp'],'usopp'],[['kaidou'],'kaido'],[['tony tony','chopper'],'tony tony chopper']];
const opAliasTargets=q=>q.length<3?[]:OP_ALIAS.filter(([ks])=>ks.some(k=>{const kn=norm(k);return kn.includes(q)||q.includes(kn)})).map(([,v])=>v);
let opIdx=null,opLoading=null;
const opVerOfId=id=>{const c=opIdx&&String(id).startsWith('op:')?opIdx.cards.find(x=>x.i===String(id).slice(3)):null;return c?opVer(c):''};
async function loadOpIndex(force){
  if(opIdx&&!force)return opIdx;
  if(opLoading)return opLoading;
  opLoading=(async()=>{
    const cached=await idb.get('op_index');
    if(!force&&cached&&cached.v===2&&Date.now()-cached.ts<INDEX_TTL){opIdx=cached;return cached}
    try{
      const get=u=>fetch(OPAPI+u).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()});
      // promos are a bonus: if the source doesn't serve them (it didn't on 22 Nov.), the sets still load
      const promo=Promise.race([get('/allPromoCards/'),new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),9000))]).catch(()=>null);
      const [sets,cards,promos]=await Promise.all([get('/allSets/'),get('/allSetCards/'),promo]);
      if(Array.isArray(promos)&&promos.length){sets.push({set_id:'PROMO',set_name:t('op_promos')});cards.push(...promos.map(c=>({...c,set_id:'PROMO',set_name:t('op_promos')})))}
      const order={};sets.forEach((s,i)=>order[s.set_id]=i);
      const list=cards.filter(c=>c&&c.card_image_id).map(c=>({i:c.card_image_id,n:c.card_name||'',s:c.set_id,sn:c.set_name||c.set_id,l:c.card_set_id||c.card_image_id,r:c.rarity||'',p:c.market_price!=null?+c.market_price:null,im:c.card_image||'',t:c.card_type||'',c:c.card_color||''}));
      const data={v:2,ts:Date.now(),cards:list,sets:sets.map((s,i)=>({id:s.set_id,n:s.set_name,o:s.set_id==='PROMO'?-1:i,count:list.filter(c=>c.s===s.set_id).length})).filter(s=>s.count)};
      idb.set('op_index',data);opIdx=data;return data;
    }catch(e){if(cached&&cached.v>=1){opIdx=cached;return cached}throw e}
    finally{opLoading=null}
  })();
  return opLoading;
}
function opToDetail(c){const v=opVer(c);return{id:'op:'+c.i,localId:c.l,name:opName(c.n),nameEn:opName(c.n),image:c.im,rarity:opRar(c.r)+(v?' · '+t('opv_'+v):''),illustrator:'',
  set:{id:c.s,name:c.sn,cardCount:{official:null}},variants:{normal:true},pricing:{tcgplayer:{normal:c.p>0?{marketPrice:c.p}:null}}}}
async function opDetail(id){const d=await loadOpIndex();const c=d.cards.find(x=>x.i===id.slice(3));if(!c)throw new Error('404');return opToDetail(c)}
// card number printed at the bottom right (OP09-118, ST01-012, EB01-061, PRB01-001, P-001)
const OP_NUM=/\b((?:OP|EB|ST|PRB)\s?\d{2}|P)\s?[-–—]\s?(\d{3})\b/i;
function parseOpNum(texts){for(const tx of texts){const m=String(tx).toUpperCase().replace(/[O](?=\d)/g,'0').replace(/0P/g,'OP').match(OP_NUM);if(m)return m[1].replace(/\s/g,'')+'-'+m[2]}return ''}
let opSearch={q:'',set:'',rar:'',special:false,sort:'num',page:1};let opOpen=false;
function viewAddOp(m){
  const lang=GAMES.op.langs.includes(settings.opLang)?settings.opLang:(settings.lang==='fr'?'fr':'en');
  const S=opSearch;
  const SRCH='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  const CAM='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  m.innerHTML=`<h1 class="hide-m">${t('add_title')}</h1>
  <div class="add-top">${gamePicker()}<div class="seg langseg" role="group" aria-label="${esc(t('card_lang'))}">${GAMES.op.langs.map(l=>`<button data-ol="${l}" class="${l===lang?'on':''}">${FLAGS[l]} ${LANG_NAMES[l]}</button>`).join('')}</div></div>
  <div class="cfilters afilters">
    <div class="cf-row">
      <div class="searchbox scanbox">${SRCH}<input maxlength="100" type="text" class="bigsearch" id="oq" placeholder="${esc(t('op_ph'))}" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search"><button type="button" class="sclear" aria-label="${esc(t('clear_search'))}" title="${esc(t('clear_search'))}" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><label class="scanic" title="${esc(t('scan_title'))}" aria-label="${esc(t('scan_title'))}">${CAM}<input type="file" accept="image/*" capture="environment" id="oScan" hidden></label></div>
      <button type="button" class="btn cf-toggle ${opOpen?'on':''}" id="ofToggle" aria-expanded="${opOpen}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg><span class="cf-count" id="ofCount"></span></button>
    </div>
    <div class="cf-panel ${opOpen?'open':''}" id="ofPanel">
      <select id="oset" aria-label="${t('set')}"><option value="">${t('all_sets')}</option></select>
      <select id="osort" aria-label="${t('sort_label')}">${[['num',t('ss_num_asc')],['price',t('ss_price')],['new',t('ss_newest')]].map(([k,l])=>`<option value="${k}" ${S.sort===k?'selected':''}>${l}</option>`).join('')}</select>
      <select id="orar" aria-label="${t('rarity')}"><option value="">${t('mg_rar_all')}</option>${['SEC','SR','L','R','UC','C','SP','TR','P'].map(r=>`<option value="${r}" ${S.rar===r?'selected':''}>${opRar(r)}</option>`).join('')}</select>
      <button type="button" class="chip ${S.special?'on':''}" id="ospec" aria-pressed="${S.special}" title="${esc(t('op_special_hint'))}">★ ${t('mg_special')}</button>
      <button type="button" class="linkbtn af-reset" id="ofReset">↺ ${t('f_reset')}</button>
    </div>
  </div>
  <div id="ores"></div>`;
  bindGamePicker(m);
  const res=m.querySelector('#ores'),oq=m.querySelector('#oq'),oset=m.querySelector('#oset');
  const nF=()=>(S.set?1:0)+(S.rar?1:0)+(S.special?1:0)+(S.sort!=='num'?1:0);
  const updCount=()=>{const n=nF(),c=m.querySelector('#ofCount');c.textContent=n||'';c.style.display=n?'':'none';m.querySelector('#ofReset').style.display=n?'':'none'};updCount();
  m.querySelectorAll('[data-ol]').forEach(b=>b.onclick=()=>{if(b.dataset.ol===lang)return;settings.opLang=b.dataset.ol;saveSettings();render()});
  m.querySelector('#ofToggle').onclick=e=>{opOpen=!opOpen;m.querySelector('#ofPanel').classList.toggle('open',opOpen);e.currentTarget.classList.toggle('on',opOpen);e.currentTarget.setAttribute('aria-expanded',opOpen)};
  if(matchMedia('(hover: hover) and (pointer: fine)').matches)setTimeout(()=>oq.focus(),30);
  const tileOf=c=>({c:{id:'op:'+c.i,n:opName(c.n),l:c.l,s:c.s,i:c.im,tag:opVer(c)?t('opv_'+opVer(c)):''},st:{n:c.sn,off:null}});
  const ready=()=>S.q.trim().length>=2||S.set||S.rar||S.special;
  const filter=d=>{
    const q=norm(S.q.trim()),num=S.q.toUpperCase().replace(/\s/g,'').match(/^((?:OP|EB|ST|PRB)\d{2}|P)?-?(\d{1,3})$/);
    const al=opAliasTargets(q);
    let list=d.cards.filter(c=>(!S.set||c.s===S.set)&&(!S.rar||c.r===S.rar)&&(!S.special||opVer(c)));
    if(q.length>=2){list=list.filter(c=>{if(num){const [a,b]=String(c.l).split('-');return (!num[1]||a===num[1])&&(b||'').endsWith(num[2].padStart(3,'0'))}
      const nn=norm(opName(c.n));return nn.includes(q)||al.some(a=>nn.includes(a))||norm(c.sn).includes(q)||norm(c.l).includes(q)})}
    const ord=Object.fromEntries(d.sets.map(s=>[s.id,s.o]));
    if(S.sort==='price')list.sort((a,b)=>(b.p||0)-(a.p||0));
    else if(S.sort==='new')list.sort((a,b)=>(ord[b.s]??0)-(ord[a.s]??0)||String(a.l).localeCompare(String(b.l))||String(a.i).localeCompare(String(b.i)));
    else list.sort((a,b)=>String(a.l).localeCompare(String(b.l))||String(a.i).localeCompare(String(b.i)));
    return list;
  };
  const draw=async()=>{
    let d;try{d=await loadOpIndex()}catch(_){res.innerHTML=`<div class="empty small"><p>${t('err_net')}</p></div>`;return}
    // rarity list: only the rarities that really exist in the data (no empty « Promo » / « Trésor » choice)
    const orar=m.querySelector('#orar');if(orar&&!orar.dataset.f){orar.dataset.f=1;const have=new Set(d.cards.map(c=>c.r));if(S.rar&&!have.has(S.rar))S.rar='';
      orar.innerHTML=`<option value="">${t('mg_rar_all')}</option>`+['SEC','SR','L','R','UC','C','SP','TR','P'].filter(r=>have.has(r)).map(r=>`<option value="${r}" ${S.rar===r?'selected':''}>${opRar(r)}</option>`).join('');updCount()}
    if(!oset.dataset.f){oset.dataset.f=1;oset.innerHTML=`<option value="">${t('all_sets')}</option>`+[...d.sets].sort((a,b)=>b.o-a.o).map(s=>`<option value="${esc(s.id)}" ${S.set===s.id?'selected':''}>${esc(s.n)} (${esc(s.id)})</option>`).join('')}
    if(!ready()){
      const pr=d.sets.find(s=>s.id==='PROMO'),sets=[...d.sets].filter(s=>s!==pr).sort((a,b)=>b.o-a.o).slice(0,pr?7:8);if(pr)sets.push(pr);   // promos always reachable from the home screen
      res.innerHTML=`<p class="muted small" style="margin:2px 0 14px">${t('op_hint')}</p><h3 class="ah-t">${t('ah_sets')}</h3><div class="ah-sets">${sets.map(s=>`<button class="ah-set" data-oset="${esc(s.id)}"><span>${esc(s.n)}</span><small class="muted">${esc(s.id)} · ${s.count} ${t('ah_cards')}</small></button>`).join('')}</div><p class="muted small" style="margin-top:14px">${t('op_src')}</p>`;
      res.querySelectorAll('[data-oset]').forEach(b=>b.onclick=()=>{S.set=b.dataset.oset;oset.value=S.set;S.page=1;updCount();draw()});return}
    const list=filter(d),shown=list.slice(0,S.page*60);
    if(!list.length){res.innerHTML=`<div class="empty small"><p>${t('op_none')}</p>${nF()?`<button class="btn" id="oNoF">${t('nr_clear')}</button>`:''}</div>`;const nf=res.querySelector('#oNoF');if(nf)nf.onclick=()=>{S.set='';S.rar='';S.special=false;S.sort='num';render()};return}
    res.innerHTML=`${lang!=='en'?`<p class="muted small" style="margin:0 0 6px">${t('op_lang_note')}</p>`:''}<p class="muted small">${t('results',{n:list.length})}</p><div class="grid" id="sgrid">${shown.map(c=>resultTile(tileOf(c),lang)).join('')}</div>${list.length>shown.length?`<button class="btn" id="oMore" style="display:block;margin:14px auto">${t('mg_more')}</button>`:''}`;
    bindTiles(res.querySelector('#sgrid'),lang);
    const mo=res.querySelector('#oMore');if(mo)mo.onclick=()=>{S.page++;draw()};
  };
  let timer;
  const go=()=>{S.q=oq.value;S.page=1;updCount();draw()};
  oq.oninput=()=>{clearTimeout(timer);timer=setTimeout(go,250)};
  searchEase(oq,()=>{clearTimeout(timer);go()});
  oq.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();clearTimeout(timer);go();oq.blur()}};
  m.querySelector('#oScan').onchange=ev=>{const f=ev.target.files[0];ev.target.value='';if(f)scanOp(f,lang,q=>{oq.value=q;S.set='';oset.value='';go()})};
  oset.onchange=()=>{S.set=oset.value;go()};
  m.querySelector('#osort').onchange=e=>{S.sort=e.target.value;go()};
  m.querySelector('#orar').onchange=e=>{S.rar=e.target.value;go()};
  m.querySelector('#ospec').onclick=e=>{S.special=!S.special;e.currentTarget.classList.toggle('on',S.special);e.currentTarget.setAttribute('aria-pressed',S.special);go()};
  m.querySelector('#ofReset').onclick=()=>{S.set='';S.rar='';S.special=false;S.sort='num';render()};
  res.innerHTML=`<p class="muted"><span class="spin"></span> ${t('op_loading')}</p>`;
  draw();
}
async function scanOp(file,lang,apply){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 12px 0">📷 ${t('scan_title')}</h2>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start"><img id="scanPrev" alt="" style="width:150px;border-radius:10px;background:var(--card2)">
    <div style="flex:1;min-width:180px"><p id="scanStatus"><span class="spin"></span> ${t('scan_loading')}</p><div id="scanOut" class="small"></div></div></div></div>`,'sm');
  const st=m.querySelector('#scanStatus'),outEl=m.querySelector('#scanOut');
  let img;try{img=await fileToImage(file);m.querySelector('#scanPrev').src=img.src}catch(e){st.textContent=t('import_bad');return}
  const rec=recognize(img,'op',lang).catch(()=>null);
  const opInfo=id=>{const c=opIdx?.cards.find(x=>x.i===id);return c&&{n:opName(c.n)+(opVer(c)?' · '+t('opv_'+opVer(c)):''),i:c.im,l:c.l,st:c.s,sn:c.sn,lang}};
  const pick=id=>{closeModal();openCard(lang,'op:'+id)};
  await loadOpIndex().catch(()=>{});
  try{
    const w=await getOcr('en');
    st.innerHTML=`<span class="spin"></span> ${t('scan_reading')}`;
    await w.setParameters({tessedit_char_whitelist:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ- '});
    const texts=[];let num='';
    for(const flt of['grayscale(1) contrast(1.7)','grayscale(1) invert(1) contrast(2.2)','grayscale(1) contrast(3) brightness(1.2)']){
      for(const[x0,x1,y0,y1]of[[0.55,1,0.9,0.99],[0.5,1,0.86,0.96]]){texts.push((await w.recognize(cropCanvas(img,x0,x1,y0,y1,4,flt))).data.text);num=parseOpNum(texts);if(num)break}
      if(num)break;st.innerHTML=`<span class="spin"></span> ${t('scan_retry')}`;
    }
    await w.setParameters({tessedit_char_whitelist:''});
    const r=await rec;
    // number read: the picture picks the version (normal, parallel, manga…) when it clearly matches one of them
    if(num){const v=r&&r.find(x=>(opIdx?.cards.find(c=>c.i===x.id)?.l)===num);if(v&&v.s<=36){closeModal();apply(num);openCard(lang,'op:'+v.id);return}
      closeModal();apply(num);toast(t('scan_op_num',{n:num}));return}
    if(recSure(r)){pick(r[0].id);return}
    st.innerHTML=`<b>${t(r&&r.length?'scan_rec_only':'scan_fail')}</b>`;
    outEl.innerHTML='';
    scanHelp(outEl,showRec(outEl,r,opInfo,pick)?null:'scan_op_tips','oScan');
  }catch(e){
    const r=await rec;
    if(recSure(r)){pick(r[0].id);return}
    st.innerHTML=`<b>${t(r&&r.length?'scan_rec_only':'scan_fail')}</b>`;
    if(!showRec(outEl,r,opInfo,pick))outEl.textContent=t('err_net');
  }
}
function viewAdd(m){
  if(gameOn()&&addGame()==='mg')return viewAddMagic(m);
  if(gameOn()&&addGame()==='op')return viewAddOp(m);
  const lang=settings.cardLang;
  const SRCH='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  const CAM='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  m.innerHTML=`
  <h1 class="hide-m">${t('add_title')}</h1>
  <div class="add-top">${gamePicker()}<div class="seg langseg" id="langSeg" role="group" aria-label="${esc(t('card_lang'))}">${['fr','en','ja'].map(l=>`<button data-l="${l}" class="${l===lang?'on':''}">${FLAGS[l]} ${LANG_NAMES[l]}</button>`).join('')}</div></div>
  <div class="cfilters afilters">
    <div class="cf-row">
      <div class="searchbox scanbox">${SRCH}<input maxlength="100" type="text" class="bigsearch" id="sq" aria-label="${t('search_ph')}" placeholder="${t('search_ph')}" value="${esc(search.q)}" autocomplete="off" enterkeyhint="search"><button type="button" class="sclear" aria-label="${esc(t('clear_search'))}" title="${esc(t('clear_search'))}" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><label class="scanic" id="scanLbl" title="${esc(t('scan_btn'))}" aria-label="${esc(t('scan_btn'))}">${CAM}<input type="file" id="scanInput" accept="image/*" hidden></label></div>
      <button type="button" class="btn cf-toggle ${afOpen?'on':''}" id="afToggle" aria-expanded="${afOpen}" aria-label="${t('filters')}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg><span class="cf-lbl">${t('filters')}</span><span class="cf-count" id="afCount"></span></button>
    </div>
    <div class="cf-panel ${afOpen?'open':''}" id="afPanel">
      <select id="sset" aria-label="${t('set')}"><option value="">${t('all_sets')}</option></select>
      <select id="ssort" aria-label="${t('sort_label')}">${['relevance','num_desc','num_asc','newest','oldest'].map(k=>`<option value="${k}" ${(settings.searchSort||'relevance')===k?'selected':''}>${t('ss_'+k)}</option>`).join('')}</select>
      <button type="button" class="chip ${settings.secretOnly?'on':''}" id="secretOnly" aria-pressed="${!!settings.secretOnly}" title="${esc(t('secret_hint'))}">★ ${t('secret_only')}</button>
      <button type="button" class="linkbtn af-reset" id="afReset">↺ ${t('f_reset')}</button>
    </div>
  </div>
  <p class="muted small" id="idxInfo" style="margin:0 0 10px"></p>
  <div id="sres"></div>`;
  const updCount=()=>{const n=(search.set?1:0)+((settings.searchSort||'relevance')!=='relevance'?1:0)+(settings.secretOnly?1:0);const c=m.querySelector('#afCount');c.textContent=n||'';c.style.display=n?'':'none';m.querySelector('#afReset').style.display=n?'':'none'};updCount();
  m.querySelector('#afReset').onclick=()=>{search.set='';search.parked='';settings.searchSort='relevance';settings.secretOnly=false;saveSettings();search.page=1;render()};
  bindGamePicker(m);
  m.querySelector('#afToggle').onclick=e=>{afOpen=!afOpen;m.querySelector('#afPanel').classList.toggle('open',afOpen);e.currentTarget.classList.toggle('on',afOpen);e.currentTarget.setAttribute('aria-expanded',afOpen)};
  // switching card language keeps the query, sort, filter and (when it exists in that language) the chosen set
  m.querySelectorAll('#langSeg button').forEach(b=>b.onclick=()=>{if(b.dataset.l===settings.cardLang)return;settings.cardLang=b.dataset.l;saveSettings();search.page=1;render()});
  const info=m.querySelector('#idxInfo'),res=m.querySelector('#sres'),sq=m.querySelector('#sq'),sset=m.querySelector('#sset');
  info.innerHTML=`<span class="spin"></span> ${t('loading_index',{l:t('lang_'+lang)})}`;
  // auto-focus only with a mouse/trackpad (computer); on touch screens the user taps the field when ready, so the keyboard doesn't pop up uninvited
  if(matchMedia('(hover: hover) and (pointer: fine)').matches)setTimeout(()=>sq.focus(),30);
  loadIndex(lang).then(data=>{
    if(settings.cardLang!==lang||view!=='add')return;
    const sets=Object.values(data.sets).sort((a,b)=>b.o-a.o);
    info.textContent='';info.style.display='none';
    // a set that doesn't exist in this language (e.g. FR set while browsing Japanese cards) is parked and restored when coming back
    if(search.set&&!data.sets[search.set]){search.parked=search.set;search.set=''}
    else if(!search.set&&search.parked&&data.sets[search.parked]){search.set=search.parked;search.parked=''}
    sset.innerHTML=`<option value="">${t('all_sets')}</option>`+sets.map(s=>`<option value="${esc(s.id)}" ${search.set===s.id?'selected':''}>${esc(s.n)}${s.off?` (${s.off})`:''}</option>`).join('');
    let timer;
    const go=()=>{search.q=sq.value;search.set=sset.value;updCount();runSearch(data,res,lang)};
    sq.oninput=()=>{clearTimeout(timer);search.page=1;timer=setTimeout(go,180)};
    searchEase(sq,()=>{clearTimeout(timer);search.page=1;go()});
    sq.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();clearTimeout(timer);go();sq.blur()}};
    sset.onchange=()=>{search.parked='';search.page=1;go()};
    m.querySelector('#ssort').onchange=e=>{settings.searchSort=e.target.value;saveSettings();search.page=1;go()};
    m.querySelector('#secretOnly').onclick=e=>{settings.secretOnly=!settings.secretOnly;saveSettings();e.currentTarget.classList.toggle('on',settings.secretOnly);e.currentTarget.setAttribute('aria-pressed',settings.secretOnly);search.page=1;go()};
    m.querySelector('#scanInput').onchange=ev=>{const f=ev.target.files[0];ev.target.value='';if(f)scanCard(f,data,lang,q=>{sq.value=q;sset.value='';search.page=1;go()})};
    go();
  }).catch(()=>{info.textContent=t('err_net')});
}

// Phone: hide the keyboard when tapping outside a text field or when scrolling the page
const isField=el=>el&&(el.tagName==='INPUT'&&!['checkbox','radio','button','submit','file','range'].includes(el.type)||el.tagName==='TEXTAREA'||el.isContentEditable);
document.addEventListener('pointerdown',ev=>{const a=document.activeElement;if(isField(a)&&!isField(ev.target)&&!ev.target.closest('label'))a.blur()},true);
document.getElementById('main').addEventListener('touchmove',()=>{const a=document.activeElement;if(isField(a)&&view==='add')a.blur()},{passive:true});

/* ============ pull to refresh (touch screens: Collection, Wishlist, Value) ============ */
(function(){
  const main=document.getElementById('main'),ptr=document.getElementById('ptr');
  const TH=70;let y0=null,dy=0,busy=false;
  const tx=ptr.querySelector('.ptr-tx'),ic=ptr.querySelector('.ptr-ic');
  const show=d=>{ptr.style.transform=`translate(-50%,${Math.min(d,TH+30)-50}px)`;ptr.style.opacity=Math.min(1,d/TH);ic.style.transform=`rotate(${d>TH?180:0}deg)`;tx.textContent=t(d>TH?'ptr_release':'ptr_pull')};
  const reset=()=>{ptr.classList.remove('busy');ptr.style.transform='';ptr.style.opacity='';dy=0;y0=null};
  main.addEventListener('touchstart',e=>{if(busy||refreshing||!['collection','wishlist','evolution'].includes(view)||document.querySelector('.ov')||main.scrollTop>0||!collection.length){y0=null;return}y0=e.touches[0].clientY;dy=0},{passive:true});
  main.addEventListener('touchmove',e=>{if(y0==null)return;dy=(e.touches[0].clientY-y0)*0.55;if(dy<=0||main.scrollTop>0){if(dy<=0)reset();return}if(e.cancelable)e.preventDefault();show(dy)},{passive:false});
  main.addEventListener('touchend',async()=>{if(y0==null)return;if(dy>TH){busy=true;ptr.classList.add('busy');ptr.style.transform='translate(-50%,24px)';tx.textContent=t('ptr_busy');try{await refreshPrices()}catch(_){}busy=false}reset()});
})();

/* ============ scan (free OCR in the browser, Tesseract.js) ============ */
let ocrWorker=null,ocrLang=null;
let chartP=null;
function loadChart(){return window.Chart?Promise.resolve():chartP||(chartP=loadScript(LIBS.chart.src,LIBS.chart.sri).catch(e=>{chartP=null;throw e}))}
// libraries from CDNs: exact version + integrity hash (tools/sri.json, computed by a GitHub job): an altered file is refused
const LIBS={sb:{src:"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js",sri:"sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ"},ocr:{src:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",sri:"sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F"},chart:{src:"https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",sri:"sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD"}};
function loadScript(src,sri){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;if(sri){s.integrity=sri;s.crossOrigin='anonymous'}s.onload=res;s.onerror=()=>rej(new Error('script'));document.head.appendChild(s)})}
async function getOcr(lang){
  if(!window.Tesseract)await loadScript(LIBS.ocr.src,LIBS.ocr.sri);
  const l=lang==='fr'?'fra':lang==='ja'?'jpn':'eng';
  if(ocrWorker&&ocrLang===l)return ocrWorker;
  if(ocrWorker){try{await ocrWorker.terminate()}catch(_){}}
  ocrWorker=await Tesseract.createWorker(l);ocrLang=l;return ocrWorker;
}
function fileToImage(file){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(file)})}
function cropCanvas(img,x0,x1,y0,y1,scale,filter='grayscale(1) contrast(1.7)'){
  const W=img.naturalWidth,H=img.naturalHeight,sw=(x1-x0)*W,sh=(y1-y0)*H,k=Math.min(scale,2400/sw);
  const c=document.createElement('canvas');c.width=Math.round(sw*k);c.height=Math.round(sh*k);
  const x=c.getContext('2d');x.filter=filter;x.drawImage(img,x0*W,y0*H,sw,sh,0,0,c.width,c.height);return c;
}
function parseNumber(texts){
  for(const tx of texts){const m=/(\d[\d ]{0,4}?)\s*\/\s*(\d{2,3})(?!\d)/.exec(tx);if(m){const a=m[1].replace(/\s/g,'');if(+a>0&&+m[2]>=10)return a+'/'+m[2]}}
  for(const tx of texts){const m=/\b(TG|GG|SV|RC)\s?(\d{1,3})\b/i.exec(tx);if(m)return(m[1]+m[2].padStart(2,'0')).toUpperCase()}
  return null;
}
function matchName(text,data){
  const tx=' '+norm(text)+' ';
  if(!data.names){const s=new Set();for(const c of data.cards){if(!c.k)c.k=norm(c.n);s.add(c.k)}data.names=[...s].filter(n=>n.length>=3).sort((a,b)=>b.length-a.length)}
  let best=null;
  for(const n of data.names){
    let i=tx.indexOf(' '+n+' ');if(i<0&&n.length>=6&&!n.includes(' '))i=tx.indexOf(n);
    if(i<0)continue;
    if(/(olution|olue|olves|from)\w*\s*(de|d)?\s*$/.test(tx.slice(Math.max(0,i-18),i)))continue; // skip "Évolution de : X"
    if(!best||n.length>best.n.length||(n.length===best.n.length&&i<best.i))best={n,i};
  }
  return best?.n||null;
}
/* ============ recognition by the picture: fingerprint of the photo vs fingerprints of every card (hashes/*.json, computed daily on GitHub) ============ */
let phashMod=null;const fpTables={};
// Mobile data: a table kept on the device is used for 24 h without asking anything; after that, the small hashes/status.json
// (a few hundred bytes) says whether it changed, and it is downloaded again only then (new cards: a few times a month).
let fpStat=null;
async function fpStatus(){
  if(fpStat&&Date.now()-fpStat.t<10*60e3)return fpStat.s;
  try{const r=await fetch('hashes/status.json?'+Math.floor(Date.now()/6e5),{cache:'no-cache'});if(!r.ok)throw 0;fpStat={t:Date.now(),s:await r.json()};return fpStat.s}catch(_){return null}
}
async function loadFp(key){
  if(fpTables[key])return fpTables[key];
  const c=await idb.get('fp_'+key).catch(()=>null);
  if(c&&Date.now()-c.ts<864e5){fpTables[key]=c.h;return c.h}
  if(c&&c.u){const st=await fpStatus(),u=st?.sets?.[key]?.updated;if(u&&u===c.u){idb.set('fp_'+key,{...c,ts:Date.now()});fpTables[key]=c.h;return c.h}}
  try{const r=await fetch(`hashes/${key}.json`,{cache:'no-cache'});if(!r.ok)throw new Error(r.status);const j=await r.json();if(!j||!j.h)throw new Error('empty');
    idb.set('fp_'+key,{ts:Date.now(),u:j.updated||'',h:j.h});fpTables[key]=j.h;return j.h}
  catch(_){if(c){fpTables[key]=c.h;return c.h}return null}
}
// best candidates [{id, s}] (s = 0…128, lower is closer), or null when the fingerprints are not available yet
async function recognize(img,game,lang){
  const key=game==='op'||game==='mg'?game:'pk-'+lang;
  const [mod,table]=await Promise.all([phashMod||(phashMod=import('./tools/phash.mjs')),loadFp(key)]);
  if(!table||!Object.keys(table).length)return null;
  const sc=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*sc)),hh=Math.max(1,Math.round(img.naturalHeight*sc));
  const cv=document.createElement('canvas');cv.width=w;cv.height=hh;const x=cv.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,w,hh);
  const g=mod.toGray(x.getImageData(0,0,w,hh).data,w,hh);
  return mod.bestMatches(mod.photoFingerprints(g,w,hh,game),table,6).filter(m=>m.s<=46);
}
const REC_SURE=26;   // a match this close, well ahead of the next one, is the card
const recSure=r=>r&&r.length&&r[0].s<=REC_SURE&&(!r[1]||r[1].s-r[0].s>=8);
// candidates under the scan result: tap the right card to open it
function showRec(box,rec,info,onPick){
  if(!rec||!rec.length)return false;
  const items=rec.map(r=>({...r,...(info(r.id)||{})})).filter(x=>x.n);
  if(!items.length)return false;
  box.insertAdjacentHTML('beforeend',`<div class="rec"><b>${t('scan_rec_t')}</b><p class="muted small">${t('scan_rec_d')}</p><div class="rec-grid">${items.map(x=>`<button type="button" class="rec-c" data-rec="${esc(x.id)}">${imgTag(x.i,x.st,x.l,x.n,'low','',x.lang)}<span class="rec-n">${esc(x.n)}</span><small>${esc(x.sn||'')}${x.l?' · '+esc(x.l):''}</small>${x.s==null?'':`<em class="rec-s ${x.s<=REC_SURE?'hi':''}">${t(x.s<=REC_SURE?'scan_rec_hi':x.s<=36?'scan_rec_mid':'scan_rec_lo')}</em>`}</button>`).join('')}</div></div>`);
  box.querySelectorAll('[data-rec]').forEach(b=>b.onclick=()=>onPick(b.dataset.rec));
  return true;
}
// failed scan: no raw text from the reader (often meaningless with a poor photo), but the tips and a new photo in one touch
function scanHelp(outEl,tipsKey,inputId){
  outEl.insertAdjacentHTML('beforeend',`${tipsKey?`<p>${t(tipsKey)}</p>`:''}<button class="btn primary" type="button" data-rescan>📷 ${t('scan_again')}</button>`);
  outEl.querySelector('[data-rescan]').onclick=()=>{closeModal();document.getElementById(inputId)?.click()};
}
async function scanCard(file,data,lang,apply){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 12px 0">📷 ${t('scan_title')}</h2>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start"><img id="scanPrev" alt="" style="width:150px;border-radius:10px;background:var(--card2)">
    <div style="flex:1;min-width:180px"><p id="scanStatus"><span class="spin"></span> ${t('scan_loading')}</p><div id="scanOut" class="small"></div></div></div></div>`,'sm');
  const st=m.querySelector('#scanStatus'),outEl=m.querySelector('#scanOut');
  let img;try{img=await fileToImage(file);m.querySelector('#scanPrev').src=img.src}catch(e){st.textContent=t('import_bad');return}
  const rec=recognize(img,'pk',lang).catch(()=>null);
  const pkInfo=id=>{const c=data.cards.find(x=>x.id===id);return c&&{n:c.n,i:c.i,l:c.l,st:c.s,sn:data.sets[c.s]?.n||c.s,lang}};
  const pick=id=>{closeModal();openCard(lang,id)};
  try{
    const w=await getOcr(lang);
    st.innerHTML=`<span class="spin"></span> ${t('scan_reading')}`;
    await w.setParameters({tessedit_char_whitelist:''});
    const top=(await w.recognize(cropCanvas(img,0,1,0,0.14,1.5))).data.text;
    await w.setParameters({tessedit_char_whitelist:'0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ '});
    const b1=(await w.recognize(cropCanvas(img,0,0.55,0.91,1,4))).data.text;
    const b2=(await w.recognize(cropCanvas(img,0.45,1,0.91,1,4))).data.text;
    let num=parseNumber([b1,b2]),extra='';
    if(!num){ // full-art cards: text sits on the artwork, retry with inverted / harder contrast
      st.innerHTML=`<span class="spin"></span> ${t('scan_retry')}`;
      for(const flt of['grayscale(1) invert(1) contrast(2.2)','grayscale(1) contrast(3) brightness(1.2)','grayscale(1) invert(1) contrast(3.5) brightness(0.9)']){
        for(const[x0,x1]of[[0,0.55],[0.45,1]]){const tx=(await w.recognize(cropCanvas(img,x0,x1,0.9,1,4,flt))).data.text;extra+=' '+tx;num=parseNumber([tx]);if(num)break}
        if(num)break;
      }
    }
    await w.setParameters({tessedit_char_whitelist:''});
    const name=matchName(top,data);
    const tries=[[name,num].filter(Boolean).join(' '),num,name].filter(Boolean);
    let q=null,found=[];
    for(const tq of tries){const r=findCards(data,tq,'');if(r.length){q=tq;found=r;break}}
    const r=await rec;
    if(!q){
      if(recSure(r)){pick(r[0].id);return}
      st.innerHTML=`<b>${t(r&&r.length?'scan_rec_only':'scan_fail')}</b>`;
      outEl.innerHTML='';
      scanHelp(outEl,showRec(outEl,r,pkInfo,pick)?null:'scan_tips','scanInput');
      return;
    }
    // several cards share the number / name: the picture decides when it clearly points to one of them
    const inFound=r&&r.find(x=>found.some(f=>f.c.id===x.id));
    if(found.length>1&&inFound&&inFound.s<=36){closeModal();apply(q);openCard(lang,inFound.id);return}
    closeModal();apply(q);
    if(found.length===1)openCard(lang,found[0].c.id);
    else toast(t('scan_found',{q,n:found.length}));
  }catch(e){
    const r=await rec;   // text reading unavailable (offline engine…): the picture alone can still find the card
    if(recSure(r)){pick(r[0].id);return}
    st.innerHTML=`<b>${t(r&&r.length?'scan_rec_only':'scan_fail')}</b>`;
    if(!showRec(outEl,r,pkInfo,pick))outEl.textContent=t('err_net');
  }
}
function runSearch(data,res,lang){
  const raw=search.q.trim();
  if(!raw&&!search.set){renderAddHome(data,res,lang);return}
  let out=findCards(data,raw,search.set);
  // a name typed in another language (« Dracaufeu » while browsing English or Japanese cards) is matched through the Pokédex number.
  // Matches that only come from the set name (e.g. a promo box named after the Pokémon) rank last, and are dropped when real cards are found.
  const words=norm(raw).split(' ').filter(w=>w&&!/\d/.test(w));
  for(const o of out)if(words.length&&!words.every(w=>(o.c.k||'').includes(w)))o.score=-1;
  const nameHits=out.filter(o=>o.score>=0).length;
  const rank=list=>settings.searchSort&&settings.searchSort!=='relevance'?list:list.sort((x,y)=>y.score-x.score||(y.st?.o??-1)-(x.st?.o??-1)||(parseInt(x.c.l)||0)-(parseInt(y.c.l)||0));
  if(words.join('').length>=3&&/[a-z]/i.test(raw)&&(lang==='ja'||nameHits<3)){ // few or no cards by that name in this language: look the name up in the other ones
    const req=++jaReq;
    if(!nameHits)res.innerHTML=`<div class="empty"><span class="spin"></span> ${t('ja_searching')}</div>`;
    crossLangIds(lang,raw).then(ids=>{
      if(req!==jaReq||view!=='add'||settings.cardLang!==lang)return;
      if(ids&&ids.size){
        const rest=norm(raw).split(' ').filter(w=>/\d/.test(w)).join(' ');
        const extra=findCards(data,rest,search.set).filter(o=>ids.has(o.c.id));
        if(extra.length){
          out=out.filter(o=>o.score>=0);
          const seen=new Set(out.map(o=>o.c.id));extra.forEach(o=>{if(!seen.has(o.c.id)){o.score=2.5;out.push(o)}});
        }
      }
      renderResults(finishResults(rank(out)),data,res,lang);
    });
    if(!nameHits)return;
  }
  renderResults(finishResults(rank(out)),data,res,lang);
}
let jaReq=0;const dexCache={};
async function crossLangIds(target,q){
  const key=target+'|'+norm(q);if(key in dexCache)return dexCache[key];
  const sources=target==='ja'?(settings.lang==='en'?['en','fr']:['fr','en']):[target==='fr'?'en':'fr'];
  const phrase=norm(q).split(' ').filter(w=>!/\d/.test(w)).join(' ');let ids=null;
  for(const srcLang of sources){
    try{
      const src=await loadIndex(srcLang);
      let cand=src.cards.filter(c=>(c.k||(c.k=norm(c.n)))===phrase);
      if(!cand.length)cand=src.cards.filter(c=>c.k.startsWith(phrase));
      for(const c of cand.slice(0,3)){
        const d=await getDetail(srcLang,c.id).catch(()=>null);
        const dex=d?.dexId?.[0];if(!dex)continue;
        // the answer is only trusted when it is really about one Pokémon: not the whole card list
        // (an ignored filter returns the whole card list, which used to flood the results)
        const ok=r=>Array.isArray(r)&&r.length>0&&r.length<=1500&&!(idx[target]&&r.length>idx[target].cards.length*0.25); // size only: Japanese names have no spaces to compare
        let r=null;
        for(const u of[`${API}/${target}/dex-ids/${dex}`,`${API}/${target}/dexIds/${dex}`,`${API}/${target}/cards?dexId=eq:${dex}`,`${API}/${target}/cards?dexId=${dex}`]){
          let j=await getJSON(u).catch(()=>null);if(j&&!Array.isArray(j)&&Array.isArray(j.cards))j=j.cards;
          if(ok(j)){r=j;break}
        }
        if(r){ids=new Set(r.map(x=>x.id));break}
      }
    }catch(_){}
    if(ids)break;
  }
  dexCache[key]=ids;return ids;
}
function finishResults(out){
  if(settings.secretOnly)out=out.filter(o=>isSecret(o.c,o.st));
  const mode=settings.searchSort||'relevance';
  if(mode!=='relevance'){
    const so=o=>o.st?.o??-1;
    out.sort(mode==='num_desc'?(a,b)=>so(b)-so(a)||numKey(b.c.l)-numKey(a.c.l)
      :mode==='num_asc'?(a,b)=>so(b)-so(a)||numKey(a.c.l)-numKey(b.c.l)
      :mode==='newest'?(a,b)=>so(b)-so(a)||numKey(a.c.l)-numKey(b.c.l)
      :(a,b)=>so(a)-so(b)||numKey(a.c.l)-numKey(b.c.l));
  }
  return out;
}
// card number as a sortable value: plain numbers first, then lettered specials (TG05, GG10, SV049…) after the main numbering
const numKey=l=>{const s=String(l||'');if(/^\d+$/.test(s))return parseInt(s,10);const n=parseInt(s.replace(/\D/g,''),10)||0;return 10000+n};
// "secret" = beyond the set's official count (illustration rares, special illustration rares, gold…) or a lettered gallery/special number
// promo sets (svp, swshp, smp, mep…) use lettered numbers for ordinary promos: never "secret"
const isPromoSet=id=>/^[a-z0-9.]*p$/i.test(id||'');
const isSecret=(c,st)=>{if(/^(mg|op):/.test(String(c.id||'')))return false;const s=String(c.l||'');if(/^\d+$/.test(s))return !!st?.off&&parseInt(s,10)>st.off;return !isPromoSet(c.s)};
const isReprintSet=s=>s==='30th-c'||/^cel25c/.test(s||'');
function findCards(data,raw,setFilter){
  const tokens=norm(raw).split(' ').filter(Boolean);
  const words=tokens.filter(x=>!/^\d+\/\d+$/.test(x)&&!/^\d+$/.test(x));
  const nums=tokens.filter(x=>/^\d+$/.test(x));
  const fracs=tokens.filter(x=>/^\d+\/\d+$/.test(x)).map(x=>x.split('/').map(Number));
  const phrase=words.join(' ');
  const out=[];
  for(const c of data.cards){
    if(setFilter&&c.s!==setFilter)continue;
    const st=data.sets[c.s];
    if(!c.k)c.k=norm(c.n);
    if(!c.h)c.h=c.k+' '+norm(st?.n)+' '+norm(st?.alt)+' '+norm(c.s)+' '+norm(c.l);
    if(words.length&&!words.every(w=>c.h.includes(w)))continue;
    const ln=parseInt(c.l,10);
    if(nums.length&&!nums.every(n=>ln===+n||c.h.split(' ').includes(n)))continue;
    if(fracs.length&&!fracs.every(([a,b])=>ln===a&&(st?.off===b||st?.tot===b)))continue;
    let score=0;
    if(phrase){if(c.k===phrase)score=3;else if(c.k.startsWith(phrase))score=2;else if(c.k.includes(phrase))score=1}
    out.push({c,st,score});
  }
  // Classic Collection reprints print the ORIGINAL card number (e.g. 58/102): add same-name reprints to number searches
  if(fracs.length&&!setFilter&&out.length){
    const best=new Map();for(const o of out)best.set(o.c.k,Math.max(best.get(o.c.k)||0,o.score));
    const have=new Set(out.map(o=>o.c.id));
    for(const c of data.cards){
      if(!isReprintSet(c.s)||have.has(c.id))continue;
      if(!c.k)c.k=norm(c.n);
      if(best.has(c.k))out.push({c,st:data.sets[c.s],score:best.get(c.k)});
    }
  }
  out.sort((a,b)=>b.score-a.score||(b.st?.o??-1)-(a.st?.o??-1)||(parseInt(a.c.l)||0)-(parseInt(b.c.l)||0));
  return out;
}
const PAGE=60;let moreObs=null;
function resultTile({c,st},lang){return `
    <div class="tile" data-id="${esc(c.id)}">
      ${(()=>{const n=ownedCount(c.id,lang);return n?`<span class="badge" title="${esc(t('owned_n',{n}))}">${n}</span>`:''})()}
      <button class="wbtn ${inWishlist(c.id,lang)?'on':''}" data-wish="${esc(c.id)}" aria-label="${esc(t('quick_wish'))}" title="${esc(t('quick_wish'))}">${HEART}</button>
      <div class="img">${imgTag(c.i,c.s,c.l,c.n,'low','',lang)}<button class="qadd" data-qadd="${esc(c.id)}" aria-label="${esc(t('qa_title'))}" title="${esc(t('qa_title'))}"><svg class="qa-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg><svg class="qa-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4 8-9"/></svg></button></div>
      <div class="nm" title="${esc(c.n)}">${esc(c.n)}</div>
      <div class="meta">${esc(st?.n||c.s)} · ${esc(numLabel(c.l,st?.off))}</div>
      ${c.tag?`<div class="meta mg-tag" title="${esc(c.tag)}">✦ ${esc(c.tag)}</div>`:isReprintSet(c.s)?`<div class="meta" style="color:var(--accent-ink)" title="${t('reprint')}">♻ ${t('reprint_short')}</div>`:isSecret(c,st)?`<div class="meta" style="color:var(--accent-ink)" title="${esc(t('secret_hint'))}">★ ${t('secret')}</div>`:''}
    </div>`}
function bindTiles(root,lang){
  root.querySelectorAll('[data-id]:not([data-b])').forEach(el=>{el.dataset.b=1;el.onclick=()=>openCard(lang,el.dataset.id)});
  root.querySelectorAll('[data-wish]:not([data-b])').forEach(b=>{b.dataset.b=1;b.onclick=ev=>{ev.stopPropagation();quickWish(lang,b.dataset.wish,b)}});
  root.querySelectorAll('[data-qadd]:not([data-b])').forEach(b=>{b.dataset.b=1;b.onclick=ev=>{ev.stopPropagation();quickAdd(lang,b.dataset.qadd,b)}});
}
function renderResults(out,data,res,lang){
  if(moreObs){moreObs.disconnect();moreObs=null}
  if(!out.length){renderNoResults(res,lang);return}
  let n=Math.min(out.length,search.page*PAGE);
  res.innerHTML=`<p class="muted small">${t('results',{n:out.length})}</p><div class="grid" id="sgrid">${out.slice(0,n).map(o=>resultTile(o,lang)).join('')}</div><div id="more" class="more-sentinel">${out.length>n?'<span class="spin"></span>':''}</div>`;
  const grid=res.querySelector('#sgrid'),sent=res.querySelector('#more');
  bindTiles(grid,lang);
  if(out.length<=n)return;
  // infinite scroll: the next 60 cards are appended as the end of the list comes into view
  const main=document.getElementById('main');const sc=/(auto|scroll)/.test(getComputedStyle(main).overflowY)?main:null;
  moreObs=new IntersectionObserver(es=>{
    if(!es.some(e=>e.isIntersecting))return;
    const next=out.slice(n,n+PAGE);n+=next.length;search.page=Math.ceil(n/PAGE);
    grid.insertAdjacentHTML('beforeend',next.map(o=>resultTile(o,lang)).join(''));bindTiles(grid,lang);
    if(n>=out.length){sent.innerHTML='';moreObs.disconnect();moreObs=null}
  },{root:sc,rootMargin:'0px 0px 800px 0px'});
  moreObs.observe(sent);
}
// search not started yet: latest sets as shortcuts + the cards opened recently, instead of an empty box
function renderAddHome(data,res,lang){
  if(moreObs){moreObs.disconnect();moreObs=null}
  const sets=Object.values(data.sets).sort((a,b)=>b.o-a.o).slice(0,8);
  const byId=new Map();const rec=LS.get('pf_recent',[]).filter(x=>obj(x)&&x.l===lang&&typeof x.id==='string');
  if(rec.length){const want=new Set(rec.map(x=>x.id));for(const c of data.cards)if(want.has(c.id))byId.set(c.id,c)}
  const recent=rec.map(x=>byId.get(x.id)).filter(Boolean).slice(0,12);
  res.innerHTML=`<p class="muted small" style="margin:2px 0 14px">${lang==='ja'?`${t('ja_hint')} ${t('ja_note')}`:t('type_to_search')}</p>
    ${sets.length?`<h3 class="ah-t">${t('ah_sets')}</h3>`:''}
    <div class="ah-sets">${sets.map(st=>`<button class="ah-set" data-set="${esc(st.id)}">${st.logo?`<span class="ah-logo"><img src="${esc(st.logo)}.webp" alt="" loading="lazy" data-err="rmp"></span>`:''}${st.sym?`<img class="ah-sym" src="${esc(st.sym)}.webp" alt="" loading="lazy" data-err="rm">`:''}<span>${esc(st.n)}</span>${(st.tot||st.off||st.cnt)?`<small class="muted">${st.tot||st.off||st.cnt} ${t('ah_cards')}</small>`:''}</button>`).join('')}</div>
    ${recent.length?`<h3 class="ah-t">${t('ah_recent')} <button class="linkbtn" id="ahClear">${t('ah_clear')}</button></h3><div class="grid">${recent.map(c=>resultTile({c,st:data.sets[c.s]},lang)).join('')}</div>`:''}`;
  bindTiles(res,lang);
  res.querySelectorAll('[data-set]').forEach(b=>b.onclick=()=>{search.set=b.dataset.set;search.parked='';search.page=1;render()});
  const cl=res.querySelector('#ahClear');if(cl)cl.onclick=()=>{LS.set('pf_recent',[]);renderAddHome(data,res,lang)};
}
// nothing found: offer to drop the filters or to look in the other card languages (with the count when that index is already loaded)
function renderNoResults(res,lang){
  const raw=search.q.trim();const filt=!!(search.set||settings.secretOnly);
  const others=['fr','en','ja'].filter(l=>l!==lang).map(l=>{let k=null;if(idx[l]&&raw){try{k=findCards(idx[l],raw,'').length}catch(_){}}return{l,k}}).filter(o=>o.k!==0);
  // searching inside a set: say in which other sets of this language the card exists (e.g. « Collection Classique 30ᵉ » vs « 30ᵉ anniversaire »)
  let inSets=[];
  if(raw&&search.set&&idx[lang]){try{const g=new Map();for(const o of findCards(idx[lang],raw,''))g.set(o.c.s,(g.get(o.c.s)||0)+1);inSets=[...g.entries()].map(([id,n])=>({id,n,st:idx[lang].sets[id]})).filter(x=>x.st).sort((a,b)=>(b.st.o??0)-(a.st.o??0)).slice(0,4)}catch(_){}}
  res.innerHTML=`<div class="empty"><p style="margin:0 0 12px">${t('no_results')}</p>
    ${inSets.length?`<p class="muted small" style="margin:0 0 8px">${t('nr_in_sets',{q:esc(raw)})}</p><div class="nr-acts" style="margin-bottom:10px">${inSets.map(x=>`<button class="btn" data-nrs="${esc(x.id)}">${esc(x.st.n)} <span class="muted">(${x.n})</span></button>`).join('')}</div>`:''}
    <div class="nr-acts">
    ${filt?`<button class="btn" id="nrClear">${t('nr_clear')}</button>`:''}
    ${raw?others.map(o=>`<button class="btn" data-nrl="${o.l}">${t('nr_in',{f:FLAGS[o.l],l:t('lang_'+o.l)})}${o.k?` <span class="muted">(${o.k})</span>`:''}</button>`).join(''):''}
  </div><p class="muted small" style="margin:16px 0 0">${t('man_hint')} <button class="linkbtn" id="nrManual">${t('man_hint_link')}</button></p></div>`;
  res.querySelector('#nrManual').onclick=()=>openManualForm({q:raw,lang});
  const c=res.querySelector('#nrClear');if(c)c.onclick=()=>{search.set='';search.parked='';settings.secretOnly=false;saveSettings();search.page=1;render()};
  res.querySelectorAll('[data-nrl]').forEach(b=>b.onclick=()=>{settings.cardLang=b.dataset.nrl;saveSettings();search.page=1;render()});
  res.querySelectorAll('[data-nrs]').forEach(b=>b.onclick=()=>{search.set=b.dataset.nrs;search.parked='';search.page=1;render()});
}

const BELL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
// quick price-alert setup from the wishlist bell
function openAlertSheet(id){
  const e=collection.find(x=>x.uid===id);if(!e)return;
  const v=entryValue(e);const a=e.alert||{dir:'below',price:v!=null?Math.max(0.01,Math.floor(v*0.9*100)/100):''};
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">🔔 ${t('alert_cfg')}</h2>
    <p class="muted small" style="margin:0 40px 12px 0">${esc(e.name)} · ${esc(e.setName)} · <span class="money">${t('unit_value')} : <b>${fmtEur(v)}</b></span></p>
    <form class="form" id="alForm" style="grid-template-columns:1fr">
      <div class="seg" style="display:flex">${['below','above'].map(d=>`<button type="button" data-dir="${d}" class="${a.dir===d?'on':''}" style="flex:1;justify-content:center">${t(d==='below'?'al_below':'al_above')}</button>`).join('')}</div>
      <label>${t('alert_price')}<input max="10000000" type="number" name="price" min="0" step="0.01" inputmode="decimal" value="${a.price||''}"></label>
      <p class="small muted" style="margin:0">${t('alert_hint')}</p>
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">
        ${e.alert?`<button type="button" class="btn danger" id="alOff">${t('al_off')}</button>`:'<span></span>'}
        <button type="submit" class="btn primary">${t(e.alert?'save':'al_on')}</button>
      </div>
    </form></div>`,'sm');
  let dir=a.dir;
  m.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{dir=b.dataset.dir;m.querySelectorAll('[data-dir]').forEach(x=>x.classList.toggle('on',x===b))});
  const f=m.querySelector('#alForm');
  f.onsubmit=ev=>{ev.preventDefault();const p=parseFloat(String(f.price.value).replace(',','.'));if(!(p>0)){f.price.focus();return}
    const same=e.alert&&e.alert.dir===dir&&e.alert.price===p;
    e.alert={dir,price:p,hit:same?e.alert.hit:null};e.upd=Date.now();saveCollection();closeModal();
    const hits=checkAlerts(false);toast(hits.length?'🔔 '+t('alert_toast',{n:hits.length}):t('al_saved'));render()};
  const off=m.querySelector('#alOff');if(off)off.onclick=()=>{e.alert=null;e.upd=Date.now();saveCollection();closeModal();toast(t('al_removed'));render()};
}
const XICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const HEART='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const ownedCount=(id,lang)=>collection.reduce((n,x)=>x.cardId===id&&x.lang===lang&&x.status!=='wish'?n+(x.qty||1):n,0);
const inWishlist=(id,lang)=>collection.some(x=>x.cardId===id&&x.lang===lang&&x.status==='wish');
function entryFromDetail(d,lang,o={}){
  const variants=VARIANTS.filter(v=>d.variants?.[v]);const variant=o.variant||variants[0]||'normal';
  const off=d.set?.cardCount?.official||idx[lang]?.sets[d.set?.id]?.off||null;
  const e={uid:uid(),cardId:d.id,lang,name:d.name,setId:d.set?.id,setName:setNameFor(lang,d.set),localId:String(d.localId),official:off,
    rarity:d.rarity||'',image:d.image||'',variant,cond:'NM',qty:1,buy:0,date:today(),status:'owned',notes:'',added:Date.now(),
    price:pickPrice(d.pricing,variant,d.variants?.normal),tcp:d.pricing?.tcgplayer||null,hist:[],upd:Date.now(),...o};
  pushHistory(e);return e;
}
// one tap = 1 copy, default version, Near Mint; the toast offers Undo and the card sheet stays available for details
async function quickAdd(lang,id,btn){
  if(btn.disabled)return;btn.disabled=true;btn.classList.add('busy');
  try{
    const d=await getDetail(lang,id);
    const e=entryFromDetail(d,lang);
    const same=collection.find(x=>x.cardId===e.cardId&&x.lang===lang&&x.status!=='wish'&&x.variant===e.variant&&x.cond===e.cond&&!x.grade);
    let undo;
    if(same){same.qty=(same.qty||1)+1;same.upd=Date.now();undo=()=>{same.qty=Math.max(1,same.qty-1);same.upd=Date.now()}}
    else{collection.push(e);undo=()=>{deleted[e.uid]=Date.now();LS.set('pf_deleted',deleted);collection=collection.filter(x=>x!==e)}}
    saveCollection();
    const tile=btn.closest('.tile');const upd=()=>{if(!tile)return;tile.querySelector('.badge')?.remove();const n=ownedCount(id,lang);if(n)tile.insertAdjacentHTML('afterbegin',`<span class="badge">${n}</span>`)};upd();
    btn.classList.add('done');setTimeout(()=>btn.classList.remove('done'),1100);
    toast(t('qa_added',{n:d.name}),{label:t('undo'),fn:()=>{undo();saveCollection();upd()}});
  }catch(_){toast(t('err_net'))}
  btn.disabled=false;btn.classList.remove('busy');
}
async function quickWish(lang,id,btn){
  if(btn.disabled)return;
  const existing=collection.filter(x=>x.cardId===id&&x.lang===lang&&x.status==='wish');
  if(existing.length){ // toggle off
    const now=Date.now();existing.forEach(x=>{deleted[x.uid]=now});LS.set('pf_deleted',deleted);
    collection=collection.filter(x=>!existing.includes(x));saveCollection();
    btn.classList.remove('on');toast(t('wish_removed',{n:existing[0].name}));return;
  }
  btn.disabled=true;btn.classList.add('busy');
  try{
    const d=await getDetail(lang,id);
    collection.push(entryFromDetail(d,lang,{status:'wish'}));saveCollection();
    btn.classList.add('on');toast(t('wish_added',{n:d.name}));
  }catch(e){toast(t('err_net'))}
  btn.disabled=false;btn.classList.remove('busy');
}

/* ============ card modal (from search) ============ */
function pricesBlock(d,variant){
  if(settings.hidePrices)return `<p class="muted small">🛡 ${t('safe_prices')}</p>`;
  const cm=d.pricing?.cardmarket,tp=d.pricing?.tcgplayer;
  const p=pickPrice(d.pricing,variant,d.variants?.normal);
  const r=priceRange(p);
  if(!cm&&!tp)return `<p class="muted">${t('no_price')}</p>`;
  const box=(l,v,f=fmtEur)=>`<div class="pbox"><div class="l">${l}</div><div class="v">${v?f(v):'—'}</div></div>`;
  let html='';
  if(r)html+=`<div class="range"><div class="small muted">${t('range')} · ${t('v_'+(variant||'normal'))}</div><b>${r.min===r.max?fmtEur(r.min):fmtEur(r.min)+' – '+fmtEur(r.max)}</b><div class="small muted">${t('range_note')}</div></div>`;
  if(cm){
    const h=k=>cm[k+'-holo']||null;
    html+=`<b class="small">${t('cm_title')}</b><div class="prices">${box(t('trend'),cm.trend)}${box(t('low'),cm.low)}${box(t('avg7'),cm.avg7)}${box(t('avg30'),cm.avg30)}</div>`;
    if(h('trend')||h('avg7'))html+=`<div class="small muted">${t('reverse_holo')}</div><div class="prices">${box(t('trend'),h('trend'))}${box(t('low'),h('low'))}${box(t('avg7'),h('avg7'))}${box(t('avg30'),h('avg30'))}</div>`;
  }
  if(tp){
    const vs=Object.entries(tp).filter(([k,v])=>typeof v==='object'&&v);
    if(vs.length)html+=`<b class="small">${t('tcp_title')}</b><div class="prices">${vs.slice(0,4).map(([k,v])=>box(k.replace(/-/g,' '),v.marketPrice??v.midPrice,fmtUsd)).join('')}</div>`;
  }
  const upd=cm?.updated||tp?.updated;
  if(upd)html+=`<div class="small muted">${t('price_upd',{d:fmtDate(upd)})}</div>`;
  return html;
}
async function openCard(lang,id){
  {try{const r=(LS.get('pf_recent',[])).filter(x=>obj(x)&&!(x.l===lang&&x.id===id));r.unshift({l:lang,id});LS.set('pf_recent',r.slice(0,24))}catch(_){}}
  openSheet(lang,id);
}
function openEntry(uid){
  const e=collection.find(x=>x.uid===uid);if(!e)return;
  openSheet(e.lang,e.cardId,{focus:uid});
}

/* ============ card sheet: one sheet for every card (search result, owned or wishlist) ============ */
const COND_D={
  fr:{MT:'parfaite, comme sortie du booster',NM:'quasi neuve, aucun défaut visible',EX:'très légères traces, à peine visibles',GD:'petites traces d’usure sur les bords ou les coins',LP:'usure légère mais nette',PL:'bien jouée, défauts visibles',PO:'abîmée : pli, déchirure ou tache'},
  en:{MT:'perfect, straight out of the pack',NM:'almost new, no visible flaw',EX:'very light marks, barely visible',GD:'minor wear on edges or corners',LP:'light but clear wear',PL:'well played, visible flaws',PO:'damaged: crease, tear or stain'}};
const condDesc=c=>`${c} · ${t('c_'+c)} : ${(COND_D[settings.lang]||COND_D.fr)[c]||''}`;
function sparkSvg(vals){
  vals=vals.filter(v=>v>0);if(vals.length<2)return '';
  const W=120,H=44,mn=Math.min(...vals),mx=Math.max(...vals),r=mx-mn||1;
  const pts=vals.map((v,i)=>[2+i*(W-4)/(vals.length-1),H-6-(v-mn)/r*(H-14)]);
  const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const up=vals[vals.length-1]>=vals[0],c=up?'var(--ok)':'var(--ko)',gid='sg'+Math.random().toString(36).slice(2,7);
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${up?'#3ecf8e':'#ff5d5d'}" stop-opacity=".32"/><stop offset="1" stop-color="${up?'#3ecf8e':'#ff5d5d'}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${pts[pts.length-1][0].toFixed(1)} ${H} L2 ${H}Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const pickSeg=(name,opts,val)=>`<input type="hidden" name="${name}" value="${esc(val)}"><div class="sh-seg" role="radiogroup">${opts.map(([v,l])=>`<button type="button" data-pick="${name}" data-val="${esc(v)}" class="${v===val?'on':''}" role="radio" aria-checked="${v===val}">${l}</button>`).join('')}</div>`;
const pickPills=(name,val)=>`<input type="hidden" name="${name}" value="${esc(val)}"><div class="sh-pills" role="radiogroup">${CONDITIONS.map(c=>`<button type="button" data-pick="${name}" data-val="${c}" class="${c===val?'on':''}" role="radio" aria-checked="${c===val}" title="${esc(t('c_'+c))}">${c}</button>`).join('')}</div><div class="sh-cdesc">${esc(condDesc(val))}</div>`;
const pickQty=(val)=>`<div class="sh-step"><button type="button" data-step="-1" aria-label="−">−</button><input max="9999" type="number" name="qty" min="1" value="${val}" inputmode="numeric"><button type="button" data-step="1" aria-label="+">+</button></div>`;
function bindPickers(f){
  f.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    const n=b.dataset.pick;f.querySelector(`input[name="${n}"]`).value=b.dataset.val;
    b.parentElement.querySelectorAll('button').forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-checked',on)});
    if(n==='cond'){const d=f.querySelector('.sh-cdesc');if(d)d.textContent=condDesc(b.dataset.val)}
    f.dispatchEvent(new CustomEvent('pick',{detail:{name:n,val:b.dataset.val}}));
  });
  f.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{const q=f.querySelector('input[name="qty"]');q.value=Math.max(1,(parseInt(q.value)||1)+parseInt(b.dataset.step))});
}
function openImageFull(html){
  document.querySelector('.imgfs')?.remove();
  const o=document.createElement('div');o.className='imgfs';
  o.innerHTML=`<button class="iconbtn imgfs-x" aria-label="close">✕</button><div class="imgfs-sc">${html}</div><p class="imgfs-hint">${t('fs_hint')}</p>`;
  document.body.appendChild(o);
  const sc=o.querySelector('.imgfs-sc'),close=()=>o.remove();
  o.querySelector('.imgfs-x').onclick=close;
  sc.onclick=ev=>{
    const z=!o.classList.contains('zoomed');const r=sc.getBoundingClientRect();const fx=(ev.clientX-r.left)/r.width,fy=(ev.clientY-r.top)/r.height;
    o.classList.toggle('zoomed',z);
    if(z)requestAnimationFrame(()=>{sc.scrollLeft=fx*sc.scrollWidth-sc.clientWidth/2;sc.scrollTop=fy*sc.scrollHeight-sc.clientHeight/2});
  };
  let y0=null,dy=0;
  o.addEventListener('touchstart',e=>{if(o.classList.contains('zoomed')||e.touches.length>1){y0=null;return}y0=e.touches[0].clientY;dy=0},{passive:true});
  o.addEventListener('touchmove',e=>{if(y0==null)return;dy=Math.max(0,e.touches[0].clientY-y0);sc.style.transform=`translateY(${dy}px)`;o.style.background=`rgba(5,7,11,${Math.max(.35,.97-dy/400)})`},{passive:true});
  o.addEventListener('touchend',()=>{if(y0==null)return;if(dy>90)close();else{sc.style.transform='';o.style.background=''}y0=null});
  const esc_=e=>{if(e.key==='Escape'){close();document.removeEventListener('keydown',esc_)}};document.addEventListener('keydown',esc_);
}
async function openSheet(lang,id,opts={}){
  const m=openModal(`<div class="mpad" style="text-align:center;padding:60px 0"><span class="spin"></span></div>`);
  let d=null;try{d=await getDetail(lang,id)}catch(_){}
  if(d&&!d.name)d=null; // unusable answer: fall back on the saved entry
  if(!m.isConnected)return;
  const any=collection.find(x=>x.cardId===id&&x.lang===lang);
  if(!d&&!any){m.querySelector('.mpad').textContent=t('err_net');return}
  const card=d?{name:d.name,setId:d.set?.id,setName:setNameFor(lang,d.set),localId:String(d.localId),off:d.set?.cardCount?.official||idx[lang]?.sets[d.set?.id]?.off||null,rarity:d.rarity||'',illu:d.illustrator||'',image:d.image||'',nameEn:d.nameEn||''}
    :{name:any.name,setId:any.setId,setName:any.setName,localId:any.localId,off:any.official,rarity:any.rarity||'',illu:'',image:any.image};
  const num=numLabel(card.localId,card.off);
  const variants=d?VARIANTS.filter(v=>d.variants?.[v]):[];if(!variants.length)variants.push(any?.variant||'normal');
  const copies=()=>collection.filter(x=>x.cardId===id&&x.lang===lang&&x.status!=='wish');
  const wishE=()=>collection.find(x=>x.cardId===id&&x.lang===lang&&x.status==='wish');
  // opened from Collection / Wishlist: same layout, card image sized to the screen height so the sheet fits without scrolling
  const compact=!!opts.focus;
  const st={variant:variants[0],editing:null,addOpen:!copies().length,focus:opts.focus||null};
  const priceFor=v=>d?pickPrice(d.pricing,v,d.variants?.normal):(collection.find(x=>x.cardId===id&&x.lang===lang&&x.variant===v)||any)?.price||null;
  const plainRarity=/^(commune|peu commune|common|uncommon|aucune|none)$/i;

  // "my price": a price the user observed (eBay sold, Vinted…), applied to the copies of the selected version
  const MY_SRC=['ebay','vinted','cm','shop','other'];
  const myTargets=()=>[...copies().filter(x=>x.variant===st.variant&&!x.grade?.co),...(wishE()?[wishE()]:[])];
  const myOf=()=>myTargets().find(x=>x.myPrice?.v>0)?.myPrice||(st.pendingMy?.variant===st.variant?st.pendingMy:null);
  function setMy(v,src){
    const est=priceFor(st.variant)?.value||0,mp={v,est,src,d:today()},tg=myTargets();
    if(tg.length){tg.forEach(x=>{x.myPrice=mp;x.upd=Date.now()});saveCollection();render()}else st.pendingMy={...mp,variant:st.variant};
  }
  function clearMy(){myTargets().forEach(x=>{if(x.myPrice){delete x.myPrice;x.upd=Date.now()}});st.pendingMy=null;saveCollection();render()}
  function priceHero(){
    if(settings.hidePrices)return `<div class="sh-price safe">🛡 ${t('safe_prices')}</div>`;
    const p=priceFor(st.variant),my=myOf();
    const pnum=printedNum(card.setId,card.localId,card.off,lang);
    const buying=!!wishE()&&!copies().length;
    const sold=buying?`<a class="sh-sold buy" target="_blank" rel="noopener" href="${esc(ebayUrl((lang==='en'&&card.nameEn)||card.name,pnum,card.setName,'',lang,card.setId,false,gameOf(id),id))}"><span class="sh-sold-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg></span><span class="sh-sold-t"><b>${t('buy_t')}</b><small>${t('buy_d')}</small></span><em>${t('sold_see')} ↗</em></a><div class="sh-sold-alt buyalt"><a target="_blank" rel="noopener" href="${esc(ebayUrl((lang==='en'&&card.nameEn)||card.name,pnum,card.setName,'',lang,card.setId,true,gameOf(id),id))}">${t('buy_sold')} ↗</a> · <a target="_blank" rel="noopener" href="${esc(cmUrl(card.nameEn||card.name,card.setName,gameOf(id),d?.mgcm))}">Cardmarket ↗</a></div>`
    :`<a class="sh-sold" target="_blank" rel="noopener" href="${esc(ebayUrl((lang==='en'&&card.nameEn)||card.name,pnum,card.setName,'',lang,card.setId,true,gameOf(id),id))}"><span class="sh-sold-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></span><span class="sh-sold-t"><b>${t('sold_t')}</b><small>${t('sold_d')}</small></span><em>${t('sold_see')} ↗</em></a><div class="sh-sold-alt">${t('sold_login')} · <a target="_blank" rel="noopener" href="https://130point.com/sales/?q=${encodeURIComponent(lang==='ja'?['pokemon japanese',card.setId,num].join(' '):['pokemon',card.name,pnum].join(' '))}">${t('sold_alt')} ↗</a></div>`;
    const links=`<div class="sh-links"><a target="_blank" rel="noopener" href="${esc(ebayUrl((lang==='en'&&card.nameEn)||card.name,pnum,card.setName,'',lang,card.setId,true,gameOf(id),id))}">eBay ↗</a><a target="_blank" rel="noopener" href="${esc(cmUrl(card.nameEn||card.name,card.setName,gameOf(id),d?.mgcm))}">Cardmarket ↗</a></div>`;
    const own=copies().find(x=>x.variant===st.variant)||wishE();
    const det=`<details class="sh-pdet"${st.detOpen?' open':''}><summary><span>${t('price_detail')}</span>${links}</summary><div class="sh-pdet-in">${d?pricesBlock(d,st.variant):''}${own?.hist?.length>1?`<b class="small">${t('history')}</b><div style="height:140px;position:relative;margin-top:6px"><canvas class="shchart"></canvas></div>`:''}</div></details>`;
    if(st.myEdit){
      const cur=my?myValue(my,p?.value):(p?.value||'');
      return `<div class="sh-price"><div class="sh-plab">${p?`${t('est_price')} · ${t('v_'+st.variant)}`:t('est_price')}</div>${p?`<div class="sh-pval">${fmtEur(p.value)}</div>`:`<div class="muted" style="margin:6px 0 2px">${t('no_price')}</div>`}
        <form class="sh-myedit" id="myForm"><div class="sh-lbl" style="margin-top:0">${t('my_label')}</div>
        <div class="sh-myinp"><input max="10000000" type="number" name="v" min="0" step="0.01" inputmode="decimal" value="${cur?Math.round(cur*100)/100:''}" required><span>€</span></div>
        <div class="sh-lbl">${t('my_src')}</div><input type="hidden" name="src" value="${my?.src||'ebay'}"><div class="sh-srcs">${MY_SRC.map(k=>`<button type="button" data-src="${k}" class="${(my?.src||'ebay')===k?'on':''}">${t('src_'+k)}</button>`).join('')}</div>
        <div class="sh-edbtns"><span></span><button type="button" class="btn" id="myCancel">${t('cancel')}</button><button type="submit" class="btn primary">${t('my_use')}</button></div></form>
        ${det}</div>`;
    }
    if(my){
      const now=myValue(my,p?.value),gap=my.est>0?(my.v-my.est)/my.est*100:(p?.value?(my.v-p.value)/p.value*100:null),cal=my.est>0&&p?.value>0;
      return `<div class="sh-price">
        <div class="sh-plab"><span>${t('my_price')} · ${t('v_'+st.variant)} <span class="sh-srctag">${t('src_'+my.src)}</span></span><span>${my.d?fmtDate(my.d):''}</span></div>
        <div class="sh-pval">${fmtEur(now)}</div>
        ${cal?`<div class="sh-prange" style="display:block">${t('my_cal',{g:fmtPct(gap)})}</div><div class="sh-prange" style="display:block">${t('my_cal2',{v:fmtEur(my.v),d:fmtDate(my.d),e:fmtEur(p.value)})}</div>`
          :p?`<div class="sh-prange" style="display:block">${t('my_est',{v:fmtEur(p.value)})}${gap!=null&&isFinite(gap)?` (${fmtPct(gap)} ${t('my_gap')})`:''}</div>`:`<div class="sh-prange" style="display:block">${t('my_fixed')}</div>`}
        <div class="sh-myrow"><button type="button" class="linkbtn" id="myEdit">${t('edit')}</button><button type="button" class="linkbtn" id="myClear">${t('my_clear')}</button></div>
        ${det}</div>`;
    }
    const chk=p&&priceCheck({uid:any?.uid,price:p,rarity:card.rarity,tcp:d?.pricing?.tcgplayer||any?.tcp,variant:st.variant});
    if(chk)return `<div class="sh-price chk">
      <div class="sh-plab"><span>${chk.alt?t('chk_alt_lab'):t('est_price')} · ${t('v_'+st.variant)}</span><span>${chk.alt?'TCGplayer':''}</span></div>
      <div class="sh-pval">${chk.alt?fmtEur(chk.alt):`<span class="pchk big">⚠ ${t('chk_short')}</span>`}<button type="button" class="info-i" id="chkInfo" aria-expanded="${!!st.chkInfo}" aria-label="${esc(t('chk_why'))}" title="${esc(t('chk_why'))}">i</button></div>
      <div class="sh-chkmsg" ${st.chkInfo?'':'hidden'}>${t(chk.alt?'chk_msg_alt':'chk_msg',{v:fmtEur(chk.cm),r:esc(card.rarity||'?')})}</div>
      ${sold}
      <div class="sh-myrow"><span class="muted small">${t('my_q')}</span><button type="button" class="linkbtn acc" id="myEdit">${t('my_cta')}</button></div>
      ${det}</div>`;
    const tpo=!p&&tcpOnly({price:null,tcp:d?.pricing?.tcgplayer||any?.tcp,variant:st.variant});
    if(tpo)return `<div class="sh-price chk">
      <div class="sh-plab"><span>${t('tcp_only_lab')}${gameOf(id)==='op'?'':' · '+t('v_'+st.variant)}</span><span>TCGplayer</span></div>
      <div class="sh-pval">${fmtEur(tpo)}<button type="button" class="info-i" id="chkInfo" aria-expanded="${!!st.chkInfo}" aria-label="${esc(t('chk_why'))}" title="${esc(t('chk_why'))}">i</button></div>
      <div class="sh-chkmsg" ${st.chkInfo?'':'hidden'}>${t(gameOf(id)==='op'?'tcp_only_msg_op':'tcp_only_msg')}</div>
      ${sold}
      <div class="sh-myrow"><span class="muted small">${t('my_q')}</span><button type="button" class="linkbtn acc" id="myEdit">${t('my_cta')}</button></div>
      ${det}</div>`;
    if(!p)return `<div class="sh-price"><div class="sh-plab">${t('est_price')}</div><div class="muted" style="margin:6px 0 2px">${t('no_price')}</div>${sold}<div class="sh-myrow"><span class="muted small">${t('my_q')}</span><button type="button" class="linkbtn acc" id="myEdit">${t('my_cta')}</button></div></div>`;
    const hist=own?.hist?.length>=3?own.hist.map(h=>h.v):null;
    const series=hist||[p.avg30,p.avg7,p.avg1,p.trend];
    const sv=series.filter(v=>v>0);const chg=sv.length>=2?(sv[sv.length-1]-sv[0])/sv[0]*100:null;
    const r=priceRange(p);
    return `<div class="sh-price">
      <div class="sh-plab"><span>${t('est_price')} · ${t('v_'+st.variant)}</span><span>Cardmarket</span></div>
      <div class="sh-prow"><div><div class="sh-pval">${fmtEur(p.value)}</div>${chg!=null&&isFinite(chg)?`<div class="sh-pchg ${chg>=0?'pos':'neg'}">${chg>=0?'▲':'▼'} ${fmtPct(chg)} ${hist?t('since_track'):t('over_30d')}</div>`:''}</div>${sparkSvg(series)}</div>
      ${r&&r.min!==r.max?`<div class="sh-prange">${t('range_short')} ${fmtEur(r.min)} – ${fmtEur(r.max)} · Cardmarket</div>`:''}
      ${sold}
      <div class="sh-myrow"><span class="muted small">${t('my_q')}</span><button type="button" class="linkbtn acc" id="myEdit">${t('my_cta')}</button></div>
      ${det}
    </div>`;
  }
  function copyRow(c){
    const v=entryValue(c),ch=c.buy>0&&v!=null?(v-c.buy)/c.buy*100:null;
    const sub=[c.buy?`<span class="money">${t('bought')} ${fmtEur(c.buy)}</span>`:'',c.date&&c.buy?t('on_date',{d:fmtDate(c.date)}):'',c.manual>0?`<span class="money">${t('manual_short')}</span>`:c.myPrice?.v>0?`<span class="money my-tag">${t('my_price_l')}</span>`:'',c.grade?.cert?`cert. ${esc(c.grade.cert)}`:'',c.alert?`🔔 <span class="money">${c.alert.dir==='below'?'≤':'≥'} ${fmtEur(c.alert.price)}</span>`:'',c.notes?esc(c.notes):''].filter(Boolean).join(' · ');
    return `<div class="sh-copy ${st.focus===c.uid?'focus':''} ${st.editing===c.uid?'open':''}" data-copy="${c.uid}">
      <div class="q">×${c.qty||1}</div>
      <div class="t"><div>${t('v_'+c.variant)} · ${esc(c.cond||'NM')}${c.grade?.co?` <span class="gbadge">${esc(gradeStr(c))}</span>`:''}</div>${sub?`<div>${sub}</div>`:''}</div>
      <div class="v money">${v!=null?fmtEur(v*(c.qty||1)):'—'}${ch!=null?`<small class="${ch>=0?'pos':'neg'}">${fmtPct(ch)}</small>`:c.manual>0?`<small>${t('manual_tag')}</small>`:''}</div>
      <button type="button" class="sh-edit" data-edit="${c.uid}" aria-label="${esc(t('edit'))}" title="${esc(t('edit'))}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg></button>
      <button type="button" class="sh-edit sh-del" data-qdel="${c.uid}" aria-label="${esc(t((c.qty||1)>1?'del_one':'delete'))}" title="${esc(t((c.qty||1)>1?'del_one':'delete'))}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>
    </div>${st.editing===c.uid?editor(c):''}`;
  }
  function editor(c){
    const vs=[...new Set([...variants,c.variant])];
    return `<form class="sh-form sh-editor" data-ed="${c.uid}">
      <div class="sh-lbl">${t('variant')}</div>${pickSeg('variant',vs.map(v=>[v,t('v_'+v)]),c.variant)}
      <div class="sh-lbl">${t('condition')}</div>${pickPills('cond',c.cond||'NM')}
      <div class="sh-lbl">${t('qty')}</div>${pickQty(c.qty||1)}
      <details class="extra"${c.buy||c.notes?' open':''}><summary>📝 ${t('buy_notes')}</summary><div class="form" style="margin-top:6px">
        <label class="money">${t('buy_price')}<input max="10000000" type="number" name="buy" min="0" step="0.01" inputmode="decimal" value="${c.buy||''}"></label>
        <label>${t('buy_date')}<input type="date" name="date" value="${esc(c.date||'')}"></label>
        <label class="full">${t('notes')}<input maxlength="2000" type="text" name="notes" value="${esc(c.notes||'')}"></label></div></details>
      ${extraFields(c)}
      <div class="sh-edbtns"><button type="button" class="btn danger" data-del="${c.uid}" aria-label="${esc(t('delete'))}">🗑<span class="ed-dl"> ${t('delete')}</span></button><span></span><button type="button" class="btn" data-cancel>${t('cancel')}</button><button type="submit" class="btn primary">${t('save')}</button></div>
    </form>`;
  }
  function addForm(){
    return `<form class="sh-form" id="shAdd">
      <div class="sh-lbl" style="margin-top:0">${t('variant')}</div>${pickSeg('variant',variants.map(v=>[v,t('v_'+v)]),st.variant)}
      <div class="sh-lbl">${t('condition')}</div>${pickPills('cond','NM')}
      <div class="sh-lbl">${t('qty')}</div>${pickQty(1)}
      <details class="extra"><summary>📝 ${t('buy_notes')}</summary><div class="form" style="margin-top:6px">
        <label class="money">${t('buy_price')}<input max="10000000" type="number" name="buy" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></label>
        <label>${t('buy_date')}<input type="date" name="date" value="${today()}"></label>
        <label class="full">${t('notes')}<input maxlength="2000" type="text" name="notes"></label></div></details>
      ${extraFields()}
    </form>`;
  }
  function draw(){
    const cs=copies(),w=wishE(),nOwn=cs.reduce((a,x)=>a+(x.qty||1),0);
    const tot=cs.reduce((a,x)=>{const v=entryValue(x);return v!=null?a+v*(x.qty||1):a},0);
    const scroller=document.getElementById('ov'),keep=scroller?scroller.scrollTop:0;
    m.innerHTML=`<button class="iconbtn mclose" id="mclose" aria-label="close">✕</button>
    <div class="sh ${compact?'compact':''}">
      <div class="sh-hero"><div class="sh-imgw">${imgTag(card.image,card.setId,card.localId,card.name,'high','cimg sh-img',lang)}<button type="button" class="sh-zoom" aria-label="${esc(t('fs_open'))}" title="${esc(t('fs_open'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6"/></svg></button></div></div>
      <div class="sh-main">
        <div class="sh-head"><div class="sh-hinfo">
        <h1 class="sh-name">${esc(card.name)} <span class="sh-flag">${FLAGS[lang]}</span></h1>
        <div class="sh-chips"><span class="sh-chip">${esc(card.setName)}</span><span class="sh-chip">${esc(num)}</span>${card.rarity?`<span class="sh-chip ${plainRarity.test(card.rarity)?'':'r'}">${plainRarity.test(card.rarity)?'':'★ '}${esc(card.rarity)}</span>`:''}${isReprintSet(card.setId)?`<span class="sh-chip r">♻ ${t('reprint_short')}</span>`:''}${any?.manualCard?`<span class="sh-chip man">✎ ${t('man_tag')}</span>`:''}</div>
        ${card.illu?`<div class="sh-illu">${t('illustrator')} : ${esc(card.illu)}</div>`:''}
        </div></div>
        ${priceHero()}
        ${w?`<div class="sh-wish"><span>${HEART}${t('in_wish')}</span><button type="button" class="linkbtn sh-prio ${w.prio?'on':''}" id="shPrio">${w.prio?'★':'☆'} ${t('prio')}</button><button type="button" class="linkbtn" id="shAlert">🔔 ${w.alert?(settings.hidePrices?t('al_active'):`${w.alert.dir==='below'?'≤':'≥'} ${fmtEur(w.alert.price)}`):t('al_short')}</button></div>`:''}
        ${cs.length?`<div class="sh-sec">${t('my_copies')} (${nOwn})</div>${cs.map(copyRow).join('')}${tot?`<div class="sh-tot money"><span>${t('copies_value')}</span><b>${fmtEur(tot)}</b></div>`:''}`:''}
        ${st.addOpen?`<div class="sh-sec" id="shAddSec">${cs.length?t('add_copy'):t('add_btn')}</div>${addForm()}`:''}
      </div>
    </div>
    <div class="sheet-cta" ${st.editing?'hidden':''}>
      <button type="button" class="btn cta-wish ${w?'on':''}" id="shWish" ${!d&&!w?'disabled':''} aria-label="${esc(t(w?'wish_remove':'add_wish_btn'))}" title="${esc(t(w?'wish_remove':'add_wish_btn'))}">${HEART}<span class="cta-lbl">${t(w?'in_wish':'cta_wish')}</span></button>
      <button type="button" class="btn primary cta-add" id="shCta">＋ ${t(st.addOpen?'add_btn':'add_copy')}</button>
    </div>`;
    if(scroller)scroller.scrollTop=keep;
    bind();
  }
  function bind(){bindTop();bindRest()}
  function bindTop(){
    m.querySelector('#mclose').onclick=closeModal;
    const img=m.querySelector('.sh-img');const full=()=>openImageFull(imgTag(card.image,card.setId,card.localId,card.name,'high','fsimg',lang));
    m.querySelector('.sh-zoom').onclick=full;if(img)img.addEventListener('click',full);
    bindPrice();
    const al=m.querySelector('#shAlert');if(al)al.onclick=()=>openAlertSheet(wishE().uid);
    const pr=m.querySelector('#shPrio');if(pr)pr.onclick=()=>{const w=wishE();w.prio=!w.prio;w.upd=Date.now();saveCollection();render();draw()};
  }
  function bindPrice(){
    const re=()=>{const ph=m.querySelector('.sh-price');if(ph){ph.outerHTML=priceHero();bindPrice()}};
    const ci=m.querySelector('#chkInfo');if(ci)ci.onclick=()=>{st.chkInfo=!st.chkInfo;const box=m.querySelector('.sh-chkmsg');box.hidden=!st.chkInfo;ci.setAttribute('aria-expanded',st.chkInfo)};
    const me=m.querySelector('#myEdit');if(me)me.onclick=()=>{st.myEdit=true;re();m.querySelector('#myForm input[name=v]')?.focus()};
    const mc=m.querySelector('#myClear');if(mc)mc.onclick=()=>{clearMy();draw();toast(t('my_cleared'))};
    const mf=m.querySelector('#myForm');
    if(mf){mf.querySelectorAll('[data-src]').forEach(b=>b.onclick=()=>{mf.src.value=b.dataset.src;mf.querySelectorAll('[data-src]').forEach(x=>x.classList.toggle('on',x===b))});
      mf.querySelector('#myCancel').onclick=()=>{st.myEdit=false;re()};
      mf.onsubmit=ev=>{ev.preventDefault();const v=parseFloat(String(mf.v.value).replace(',','.'));if(!(v>0))return;setMy(Math.round(v*100)/100,mf.src.value);st.myEdit=false;draw();toast(t('my_saved'))}}
    const det=m.querySelector('.sh-pdet');
    det?.querySelectorAll('.sh-links a').forEach(a=>a.addEventListener('click',e=>e.stopPropagation()));
    if(det)det.addEventListener('toggle',()=>{st.detOpen=det.open;const cv=det.querySelector('.shchart');const own=copies().find(x=>x.variant===st.variant)||wishE();
      if(det.open&&cv&&!cv.dataset.on&&own?.hist?.length>1){cv.dataset.on=1;loadChart().then(()=>{if(cv.isConnected)charts.push(new Chart(cv,{type:'line',data:{labels:own.hist.map(h=>fmtDate(h.d)),datasets:[{data:own.hist.map(h=>h.v),borderColor:getCss('--accent'),backgroundColor:'transparent',tension:.3,pointRadius:2}]},options:chartOpts(false)}))}).catch(()=>{cv.dataset.on=''})}});
  }
  function bindRest(){
    // copies: edit inline
    m.querySelectorAll('[data-edit]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();st.editing=st.editing===b.dataset.edit?null:b.dataset.edit;st.focus=null;draw();m.querySelector('.sh-editor')?.scrollIntoView({block:'nearest',behavior:'smooth'})});
    m.querySelectorAll('[data-copy]').forEach(r=>r.onclick=()=>r.querySelector('[data-edit]').click());
    m.querySelectorAll('[data-qdel]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();delCopy(b.dataset.qdel,true)});
    const ed=m.querySelector('.sh-editor');
    if(ed){
      bindPickers(ed);
      ed.querySelector('[data-cancel]').onclick=()=>{st.editing=null;draw()};
      ed.querySelector('[data-del]').onclick=()=>delCopy(ed.dataset.ed);
      ed.onsubmit=async ev=>{
        ev.preventDefault();
        const c=collection.find(x=>x.uid===ed.dataset.ed);if(!c)return;
        const variantChanged=ed.variant.value!==c.variant;
        Object.assign(c,{variant:ed.variant.value,cond:ed.cond.value,qty:Math.max(1,parseInt(ed.qty.value)||1),buy:parseFloat(String(ed.buy.value).replace(',','.'))||0,date:ed.date.value,notes:ed.notes.value.trim(),upd:Date.now(),...readExtra(ed,c)});
        if(variantChanged){const p=priceFor(c.variant);if(p){c.price=p;pushHistory(c)}}
        saveCollection();render();st.editing=null;draw();
        const hits=checkAlerts(false);toast(hits.length?'🔔 '+t('alert_toast',{n:hits.length}):t('saved'));
      };
    }
    // add form
    const f=m.querySelector('#shAdd');
    if(f){bindPickers(f);f.addEventListener('pick',e=>{if(e.detail.name==='variant'){st.variant=e.detail.val;const ph=m.querySelector('.sh-price');if(ph){ph.outerHTML=priceHero();bindPrice()}}});f.onsubmit=ev=>{ev.preventDefault();addNow()}}
    m.querySelector('#shCta').onclick=()=>{
      if(!st.addOpen){st.addOpen=true;st.editing=null;draw();const sec=m.querySelector('#shAddSec');sec?.scrollIntoView({block:'start',behavior:'smooth'});return}
      addNow();
    };
    m.querySelector('#shWish').onclick=()=>{
      const w=wishE();
      if(w){deleted[w.uid]=Date.now();LS.set('pf_deleted',deleted);collection=collection.filter(x=>x!==w);saveCollection();render();draw();
        toast(t('wish_removed',{n:card.name}),{label:t('undo'),fn:()=>{delete deleted[w.uid];LS.set('pf_deleted',deleted);w.upd=Date.now();collection.push(w);saveCollection();render();if(m.isConnected)draw()}});return}
      if(!d)return;
      collection.push(entryFromDetail(d,lang,{status:'wish',variant:st.variant}));saveCollection();render();draw();toast(t('wish_added',{n:card.name}));
    };
  }
  function delCopy(cid,one){
    const c=collection.find(x=>x.uid===cid);if(!c)return;
    // trash icon on a ×2+ line removes a single copy; the editor's Delete button removes the whole line
    if(one&&(c.qty||1)>1){c.qty--;c.upd=Date.now();saveCollection();render();draw();
      toast(t('deleted_one',{n:card.name}),{label:t('undo'),fn:()=>{c.qty++;c.upd=Date.now();saveCollection();render();if(m.isConnected)draw()}});return}
    deleted[c.uid]=Date.now();LS.set('pf_deleted',deleted);collection=collection.filter(x=>x!==c);saveCollection();render();
    st.editing=null;if(!copies().length)st.addOpen=true;draw();
    toast(t('deleted_n',{n:card.name}),{label:t('undo'),fn:()=>{delete deleted[c.uid];LS.set('pf_deleted',deleted);c.upd=Date.now();collection.push(c);saveCollection();render();if(m.isConnected){st.addOpen=false;draw()}}});
  }
  function addNow(){
    const f=m.querySelector('#shAdd');if(!f)return;
    const variant=f.variant.value;
    const e={uid:uid(),cardId:id,lang,name:card.name,setId:card.setId,setName:card.setName,localId:card.localId,official:card.off||null,
      rarity:card.rarity,image:card.image,variant,cond:f.cond.value,qty:Math.max(1,parseInt(f.qty.value)||1),
      buy:parseFloat(String(f.buy.value).replace(',','.'))||0,date:f.date.value,status:'owned',notes:f.notes.value.trim(),added:Date.now(),
      price:priceFor(variant),tcp:d?.pricing?.tcgplayer||null,hist:[],upd:Date.now(),...readExtra(f)};
    if(st.pendingMy?.variant===variant)e.myPrice={v:st.pendingMy.v,src:st.pendingMy.src,d:st.pendingMy.d};
    pushHistory(e);
    const plain=x=>!x.buy&&!x.grade&&!x.manual&&!x.alert&&!x.notes;
    const same=plain(e)&&collection.find(x=>x.cardId===e.cardId&&x.lang===e.lang&&x.variant===e.variant&&x.cond===e.cond&&x.status==='owned'&&plain(x));
    if(same){same.qty+=e.qty;same.price=e.price;same.upd=Date.now();pushHistory(same)}else collection.push(e);
    // got it: the card leaves the wishlist
    const w=wishE();let msg=t('added',{n:card.name});
    if(w){deleted[w.uid]=Date.now();LS.set('pf_deleted',deleted);collection=collection.filter(x=>x!==w);msg=t('added_from_wish',{n:card.name})}
    saveCollection();closeModal();render();toast(msg);
    if(checkAlerts(false).length)toast('🔔 '+t('alert_toast',{n:1}));
  }
  draw();
}
const getCss=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function chartOpts(legend){
  const c=getCss('--muted'),g=getCss('--line');
  return{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:legend,labels:{color:c}},tooltip:{callbacks:{label:x=>(x.dataset.label?x.dataset.label+' : ':'')+fmtEur(x.parsed.y)}}},
    scales:{x:{ticks:{color:c,maxTicksLimit:8},grid:{color:g}},y:{ticks:{color:c,callback:v=>fmtEur(v)},grid:{color:g}}}};
}

/* ============ view: wishlist ============ */
function viewWish(m){
  // priority cards first, then the most expensive
  const list=collection.filter(e=>e.status==='wish'&&inView(e)).sort((a,b)=>(b.prio?1:0)-(a.prio?1:0)||(entryValue(b)||0)-(entryValue(a)||0));
  const deals=list.map(e=>({e,d:wishDeal(e)})).filter(x=>x.d).sort((a,b)=>(b.e.prio?1:0)-(a.e.prio?1:0)||a.d.pct-b.d.pct);
  const total=list.reduce((s,e)=>s+(entryValue(e)||0)*e.qty,0);
  m.innerHTML=`<div class="wish-head"><h1>${t('wish_title')}</h1>${list.length?`<button type="button" class="btn btn-sm" id="wShare"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>${t('share')}</button>`:''}</div>${gameChip()}
  ${list.length?`<div class="stat wbudget money"><div class="lbl">${t('wish_budget')}</div><div class="val">${fmtEur(total)}</div><div class="sub">${t('wish_count',{n:list.reduce((a,e)=>a+(e.qty||1),0)})}</div></div>${deals.length&&!settings.hidePrices?`<div class="deals"><div class="deals-h"><span>🏷 ${t('deals_title',{n:deals.length})}<button class="deals-cfg" id="dealCfg" aria-label="${esc(t('deal_cfg')+' · '+t('deal_rule',{p:settings.dealPct||5}))}" title="${esc(t('deal_rule',{p:settings.dealPct||5}))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></span></div><div class="deals-row">${deals.map(({e,d})=>`<button class="deal" data-open="${e.uid}"><span class="deal-im">${imgTag(e.image,e.setId,e.localId,'','low','',e.lang)}</span><span class="deal-t"><b>${e.prio?'★ ':''}${esc(e.name)}</b><span>${fmtEur(entryValue(e))} · <em class="pos">${d.hit?t('deal_hit'):fmtPct(d.pct)}</em></span></span></button>`).join('')}</div></div>`:''}<div class="grid">${list.map(e=>entryTile(e,{remove:true,bell:true,wish:true})).join('')}</div>`:`<div class="empty">${t('wish_empty')}</div>`}`;
  m.querySelectorAll('[data-uid]').forEach(el=>el.onclick=()=>openEntry(el.dataset.uid));
  m.querySelectorAll('[data-bell]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();openAlertSheet(b.dataset.bell)});
  m.querySelectorAll('.deal[data-open]').forEach(b=>b.onclick=()=>openEntry(b.dataset.open));
  const dc=m.querySelector('#dealCfg');if(dc)dc.onclick=openDealSheet;
  const ws=m.querySelector('#wShare');if(ws)ws.onclick=()=>openShareSheet();
  m.querySelectorAll('[data-prio]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();const e=collection.find(x=>x.uid===b.dataset.prio);if(!e)return;e.prio=!e.prio;e.upd=Date.now();saveCollection();render();toast(t(e.prio?'prio_on':'prio_off',{n:e.name}))});
  m.querySelectorAll('[data-x]').forEach(b=>b.onclick=ev=>{
    ev.stopPropagation();
    const e=collection.find(x=>x.uid===b.dataset.x);if(!e)return;
    deleted[e.uid]=Date.now();LS.set('pf_deleted',deleted);
    collection=collection.filter(x=>x!==e);saveCollection();render();
    toast(t('wish_removed',{n:e.name}),{label:t('undo'),fn:()=>{delete deleted[e.uid];LS.set('pf_deleted',deleted);e.upd=Date.now();collection.push(e);saveCollection();render()}});
  });
  m.querySelectorAll('.alerts [data-open]').forEach(el=>el.onclick=()=>openEntry(el.dataset.open));
  bindAlerts(m,e=>e.status==='wish');
}

/* ============ view: evolution ============ */
let evoPer='30',evoMov='up',evoRep='set',evoMore=false;
const REP_COLORS=['#ffcb05','#8b7bff','#3ecf8e','#5ec8ff','#ff7ac3','#59617a'];
function viewEvo(m){
  const owned=collection.filter(e=>e.status!=='wish'&&inView(e));
  const tt=totals(owned);
  if(owned.length&&settings.hidePrices){m.innerHTML=`<h1>${t('evo_title')}</h1><div class="empty"><p style="font-size:28px;margin:0 0 6px">🛡</p><p>${t('safe_value')}</p><button class="btn primary" id="safeOff">${t('priv_show')}</button></div>`;m.querySelector('#safeOff').onclick=()=>setPriv(false);return}
  if(!owned.length){m.innerHTML=`<h1>${t('evo_title')}</h1>${gameChip()}<div class="empty"><p>${t('empty_collection')}</p><a class="btn primary" href="#add">＋ ${t('go_add')}</a></div>`;return}
  // chart period
  const days={'7':7,'30':30,'365':365,all:1e5}[evoPer];
  const from=new Date(Date.now()-days*864e5).toISOString().slice(0,10);
  const snaps=(gvActive()?snapshots.map(s=>({...s,value:s.g?.[settings.gameView]??null})):snapshots).filter(s=>s.d>=from&&s.value!=null);
  const pd=snaps.length>1?snaps[snaps.length-1].value-snaps[0].value:null,pp=pd!=null&&snaps[0].value?pd/snaps[0].value*100:null;
  // top cards
  const top=[...owned].filter(e=>entryValue(e)!=null).sort((a,b)=>entryValue(b)*b.qty-entryValue(a)*a.qty).slice(0,10);
  // movements
  const ch=owned.map(e=>{const c=change7(e),v=entryValue(e);return{e,c,d:c!=null&&v!=null?(v-v/(1+c/100))*e.qty:null}}).filter(x=>x.c!=null&&Math.abs(x.c)>=0.5);
  const lists={up:ch.filter(x=>x.c>0).sort((a,b)=>b.c-a.c),down:ch.filter(x=>x.c<0).sort((a,b)=>a.c-b.c),
    gain:owned.filter(e=>e.buy>0&&entryValue(e)!=null).map(e=>{const v=entryValue(e);return{e,c:(v-e.buy)/e.buy*100,d:(v-e.buy)*e.qty}}).sort((a,b)=>b.d-a.d)};
  const mv=lists[evoMov],shown=evoMore?mv:mv.slice(0,5);
  // breakdown
  if(evoRep==='game'&&(gvActive()||!multiGame()))evoRep='set';
  const key={set:e=>e.setName||'—',lang:e=>e.lang,rar:e=>e.rarity||t('rar_none'),game:e=>GAMES[gameOf(e)].n}[evoRep];
  const g={};for(const e of owned){const k=key(e);g[k]=(g[k]||0)+(entryValue(e)||0)*e.qty}
  let rows=Object.entries(g).sort((a,b)=>b[1]-a[1]);const sum=rows.reduce((a,r)=>a+r[1],0)||1;
  if(rows.length>5){const rest=rows.slice(4);rows=[...rows.slice(0,4),[t('others',{n:rest.length}),rest.reduce((a,r)=>a+r[1],0),1]]}
  const lab=n=>evoRep==='lang'&&FLAGS[n]?`<span class="lflag">${FLAGS[n]}</span>${esc(LANG_NAMES[n]||n)}`:esc(n);
  // wishlist summary
  const wl=collection.filter(e=>e.status==='wish'&&inView(e));const wBudget=wl.reduce((a,e)=>a+(entryValue(e)||0)*(e.qty||1),0);const wDeals=wl.filter(wishDeal).length;
  const seg=(name,cur,opts)=>`<div class="ev-seg" role="tablist">${opts.map(([k,l])=>`<button type="button" data-${name}="${k}" class="${k===cur?'on':''}" role="tab" aria-selected="${k===cur}">${l}</button>`).join('')}</div>`;
  const thumb=e=>`<span class="ev-th">${imgTag(e.image,e.setId,e.localId,'','low','',e.lang)}</span>`;
  m.innerHTML=`${gameChip()}
  <div class="ev-hero">
    <div class="ev-lbl">${t('ev_value')} <button class="iconbtn ev-ref hide-m" id="refreshBtn" title="${esc(t('refresh'))}" aria-label="${esc(t('refresh'))}">↻</button></div>
    <div class="ev-big">${fmtEur(tt.value)}</div>
    ${tt.withCost?`<div class="ev-gain ${tt.gain>=0?'pos':'neg'}">${tt.gain>=0?'▲ +':'▼ '}${fmtEur(tt.gain)} <span>(${fmtPct(tt.gainPct)})</span></div>`:''}
    <div class="ev-cost">${tt.withCost?`${t('stat_cost')} ${fmtEur(tt.cost)} · `:''}${t('n_cards',{n:tt.count})}</div>
    ${(()=>{const sp=priceSuspects(owned),n=sp.filter(e=>!priceCheck(e).alt).length,a=sp.length-n;return sp.length?`<button class="ev-chk" id="evChk">⚠ ${n?t('chk_val',{n}):''}${n&&a?' · ':''}${a?t('chk_val_alt',{n:a}):''} <span>${t('see_all')} ›</span></button>`:''})()}
  </div>
  ${snaps.length>1?`<div class="ev-chart"><canvas id="evo"></canvas></div>`:`<div class="ev-nochart">${t(snapshots.length>1?'ev_no_period':'evo_empty')}</div>`}
  ${seg('per',evoPer,[['7',t('p_7')],['30',t('p_30')],['365',t('p_365')],['all',t('p_all')]])}
  ${pd!=null?`<div class="ev-perchg">${t('ev_over',{p:t('pl_'+evoPer)})} <b class="${pd>=0?'pos':'neg'}">${pd>=0?'+':''}${fmtEur(pd)} (${fmtPct(pp)})</b></div>`:''}

  <div class="ev-sec"><h2>${t('ev_best')}</h2><a href="#collection" id="evAll">${t('see_all')} ›</a></div>
  <div class="ev-car">${top.map((e,i)=>`<button class="ev-cc" data-open="${e.uid}"><span class="ev-im">${imgTag(e.image,e.setId,e.localId,e.name,'low','',e.lang)}<span class="ev-rk">${i+1}</span></span><span class="ev-n">${esc(e.name)}${e.qty>1?` <span class="muted">×${e.qty}</span>`:''}</span><span class="ev-v">${fmtEur(entryValue(e)*e.qty)}</span></button>`).join('')}</div>

  <div class="ev-two">
  <div>
    <div class="ev-sec"><h2>${t('ev_moves')}</h2><span class="muted small">${t(evoMov==='gain'?'ev_vs_buy':'ev_7d')}</span></div>
    <div class="ev-box">
      ${seg('mov',evoMov,[['up','▲ '+t('ev_up')],['down','▼ '+t('ev_down')],['gain',t('ev_gains')]])}
      ${shown.length?shown.map(x=>`<div class="ev-row" data-open="${x.e.uid}">${thumb(x.e)}<div class="t"><div>${esc(x.e.name)}${x.e.qty>1?` <span class="muted small">×${x.e.qty}</span>`:''}</div><div>${esc(x.e.setName)} · ${esc(numLabel(x.e.localId,x.e.official))}</div></div><div class="r ${x.c>=0?'pos':'neg'}">${fmtPct(x.c)}<small>${x.d>=0?'+':''}${fmtEur(x.d)}</small></div></div>`).join(''):`<p class="muted small ev-empty">${t(evoMov==='gain'?'ev_no_gain':'no_movers')}</p>`}
      ${mv.length>5?`<button class="ev-more" id="evMore">${evoMore?t('see_less'):t('ev_see_n',{n:mv.length})} ${evoMore?'‹':'›'}</button>`:''}
    </div>
  </div>
  <div>
    <div class="ev-sec"><h2>${t('ev_rep')}</h2></div>
    <div class="ev-box">
      ${seg('rep',evoRep,[...(multiGame()&&!gvActive()?[['game',t('ev_game')]]:[]),['set',t('set')],['lang',t('ev_lang')],['rar',t('rarity')]])}
      <div class="ev-stack">${rows.map(([n,v],i)=>`<i style="width:${Math.max(1.5,v/sum*100)}%;background:${REP_COLORS[i===rows.length-1&&rows[i][2]?5:i]}"></i>`).join('')}</div>
      ${rows.map(([n,v],i)=>`<div class="ev-leg"><i style="background:${REP_COLORS[i===rows.length-1&&rows[i][2]?5:i]}"></i><span>${lab(n)}</span><em>${Math.round(v/sum*100)} %</em><b>${fmtEur(v)}</b></div>`).join('')}
    </div>
  </div>
  </div>

  ${wl.length?`<a class="ev-wl" href="#wishlist"><span class="ev-wl-ic">${HEART}</span><div><b>${t('nav_wish')}</b><span>${t('wish_count',{n:wl.reduce((a,e)=>a+(e.qty||1),0)})}${wDeals?' · '+t('ev_deals',{n:wDeals}):''}</span></div><em>${fmtEur(wBudget)}</em><span class="muted">›</span></a>`:''}`;
  const rb=m.querySelector('#refreshBtn');if(rb)rb.onclick=()=>refreshPrices();
  const ck=m.querySelector('#evChk');if(ck)ck.onclick=openSuspectList;
  m.querySelectorAll('[data-open]').forEach(el=>el.onclick=()=>openEntry(el.dataset.open));
  m.querySelector('#evAll').onclick=()=>{settings.sort='value';saveSettings()};
  m.querySelectorAll('[data-per]').forEach(b=>b.onclick=()=>{evoPer=b.dataset.per;render()});
  m.querySelectorAll('[data-mov]').forEach(b=>b.onclick=()=>{evoMov=b.dataset.mov;evoMore=false;render()});
  m.querySelectorAll('[data-rep]').forEach(b=>b.onclick=()=>{evoRep=b.dataset.rep;render()});
  const mo=m.querySelector('#evMore');if(mo)mo.onclick=()=>{evoMore=!evoMore;render()};
  if(snaps.length>1){const drawEvo=()=>{
    const cv=m.querySelector('#evo'),ctx=cv.getContext('2d'),up=pd>=0,col=up?getCss('--ok'):getCss('--ko');
    const grad=ctx.createLinearGradient(0,0,0,cv.parentElement.clientHeight||170);grad.addColorStop(0,up?'rgba(62,207,142,.32)':'rgba(255,93,93,.28)');grad.addColorStop(1,'rgba(0,0,0,0)');
    const mc=getCss('--muted'),gc=getCss('--line');
    charts.push(new Chart(cv,{type:'line',data:{labels:snaps.map(s=>fmtDate(s.d)),datasets:[{data:snaps.map(s=>s.value),borderColor:col,backgroundColor:grad,fill:true,tension:.35,pointRadius:0,pointHoverRadius:5,borderWidth:2.5}]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{displayColors:false,callbacks:{label:x=>fmtEur(x.parsed.y)}}},
        scales:{x:{display:false},y:{position:'right',grid:{color:gc,drawTicks:false},border:{display:false},ticks:{color:mc,maxTicksLimit:4,padding:6,callback:v=>fmtEur(v).replace(/,00/,'')}}}}}));};
    // the charts library is fetched on demand (it no longer blocks the first display); offline without it, the plain message is shown
    if(window.Chart)drawEvo();else loadChart().then(()=>{if(m.querySelector('#evo')?.isConnected)drawEvo()}).catch(()=>{const c=m.querySelector('.ev-chart');if(c)c.outerHTML=`<div class="ev-nochart">${t(snapshots.length>1?'ev_no_period':'evo_empty')}</div>`})
  }
}

/* ============ view: data ============ */
function download(name,content,type){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
// small bottom sheet with a list of choices (Settings rows with ›)
function openChoice(title,desc,opts,cur,onPick){
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">${title}</h2>${desc?`<p class="muted small" style="margin:0 0 8px">${desc}</p>`:''}
    <div class="ch-list">${opts.map(([v,l])=>`<button type="button" class="ch-opt ${String(v)===String(cur)?'on':''}" data-v="${esc(String(v))}"><span>${l}</span>${String(v)===String(cur)?'<b>✓</b>':''}</button>`).join('')}</div></div>`,'sm');
  m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{closeModal();onPick(b.dataset.v)});
}
const SICON={
  lang:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9"/>',
  theme:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  pill:'<circle cx="12" cy="12" r="8"/><path d="M10 9.5c.6-1 3.5-1.2 3.5.8 0 1.6-2.6 1.4-2.6 1.4s2.9-.1 2.9 1.9c0 2-3.2 1.9-3.9.7"/>',
  safe:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  deal:'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  notif:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  exp:'<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  imp:'<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  csv:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  tour:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  reload:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  manual:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 12h6M12 9v6"/>',
  noimg:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 8M3 3l18 18"/>'
};
function viewData(m){
  const ico=(k,c)=>`<span class="s-ic s-${c}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SICON[k]}</svg></span>`;
  const line=(k,c,title,desc,right,id,tag='button')=>`<${tag} ${tag==='button'?'type="button"':''} class="s-row" ${id?`id="${id}"`:''}>${ico(k,c)}<span class="s-t"><span>${title}</span>${desc?`<small>${desc}</small>`:''}</span>${right}</${tag}>`;
  const chev='<span class="s-chev">›</span>',val=v=>`<span class="s-val">${v}</span>`;
  const sw=(on,id)=>`<span class="s-sw ${on?'on':''}" id="${id}" role="switch" aria-checked="${on}"></span>`;
  const nCards=collection.filter(e=>e.status!=='wish').reduce((a,e)=>a+(e.qty||1),0);
  const notifOK='Notification' in window,notifOn=notifOK&&Notification.permission==='granted'&&settings.notif!==false;
  const pillL={s:t('pill_s'),m:t('pill_m'),l:t('pill_l')};
  m.innerHTML=`<h1 class="s-title">${t('data_title')}</h1>
  <div class="s-wrap">
  ${user?`<button type="button" class="s-acc" id="accOpen"><span class="s-av on">${esc((user.email||'?')[0].toUpperCase())}</span><span class="s-acc-t"><b>${esc(user.email)}</b><span id="syncInfo">${syncLabel()}</span></span><span class="s-chev">›</span></button>`
    :`<div class="s-acc guest"><div class="s-acc-top"><span class="s-av"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></span><span class="s-acc-t"><b>${t('guest')}</b><span>${t('guest_d')}</span></span></div>
      <button type="button" class="btn primary s-acc-btn" id="accOpen">${t('tour_acc')}</button><button type="button" class="linkbtn s-acc-link" id="accLogin">${t('have_account')}</button></div>`}

  <div class="s-gl">${t('display')}</div>
  <div class="s-grp">
    ${line('lang','blue',t('lang_label'),'',val(settings.lang==='en'?'English':'Français')+chev,'sLang')}
    <div class="s-row">${ico('theme','violet')}<span class="s-t"><span>${t('theme_label')}</span></span><span class="s-mseg">${['dark','light'].map(v=>`<button type="button" data-tv="${v}" class="${settings.theme===v?'on':''}">${t('theme_'+v)}</button>`).join('')}</span></div>
    ${line('pill','gold',t('pill_short'),'',val(pillL[settings.pill||'m'])+chev,'sPill')}
    ${line('safe','green',t('priv_t'),t('safe_short'),sw(!!settings.hidePrices,'sSafeSw'),'sSafe')}
  </div>

  <div class="s-gl">${t('sec_wishalerts')}</div>
  <div class="s-grp">
    ${line('deal','green',t('deal_cfg'),t('deal_short'),val('≥ '+(settings.dealPct||5)+' %')+chev,'sDeal')}
    ${line('notif','gold',t('notif_t'),notifOK?t('notif_short'):t('notif_off'),notifOK?sw(notifOn,'sNotifSw'):'','sNotif')}
  </div>

  <div class="s-gl">${t('sec_mydata')}</div>
  <div class="s-grp">
    ${line('exp','blue',t('exp_json_t'),t('exp_json_d2',{n:nCards}),chev,'exJson')}
    <label class="s-row">${ico('imp','violet')}<span class="s-t"><span>${t('imp_t')}</span><small>${t('imp_d2')}</small></span>${chev}<input type="file" id="imp" accept=".json,application/json" hidden></label>
    ${line('csv','green',t('exp_csv_t'),t('exp_csv_d'),chev,'exCsv')}
  </div>
  ${user?'':`<p class="s-note">${t('data_note2')}</p>`}

  <div class="s-gl">${t('sec_help')}</div>
  <div class="s-grp">
    ${line('tour','gold',t('tour_again_t'),'',chev,'tourAgain')}
    ${line('manual','violet',t('man_list'),t('man_row_d'),(manualCards().length?val(manualCards().length):'')+chev,'sManual')}
    ${line('noimg','grey',t('ni_title'),t('ni_row_d'),val(noImgCards().length)+chev,'sNoImg')}
    ${line('reload','grey',t('rl_title'),t('rl_row_d'),chev,'sRLog')}
    ${line('reload','grey',t('el_title'),t('el_row_d',{n:LS.get('pf_errlog',[]).length}),chev,'sELog')}
    ${line('reload','grey',t('reload_t'),t('reload_d'),chev,'clr')}
  </div>

  <div class="s-about">
    <span class="s-logo">${document.querySelector('.logo svg')?.outerHTML||''}</span>
    <b>Gleamvault</b>
    <span>v${APP_VERSION} · ${t('ab_line')}</span>
    ${(()=>{const L=['fr','en','ja'].filter(l=>idx[l]);return L.length?`<span class="s-ab-n">${L.map(l=>`${FLAGS[l]} ${t('ab_ncards',{n:idx[l].cards.length.toLocaleString()})}`).join(' · ')}</span>`:''})()}
    <p>${t('ab_legal')}</p>
  </div>
  </div>`;
  const q=s=>m.querySelector(s);
  q('#accOpen').onclick=()=>openAccount();
  const al=q('#accLogin');if(al)al.onclick=()=>openAccount();
  q('#sLang').onclick=()=>openChoice(t('lang_label'),'',[['fr','🇫🇷 Français'],['en','🇬🇧 English']],settings.lang,v=>setLang(v));
  m.querySelectorAll('button[data-tv]').forEach(b=>b.onclick=()=>{settings.theme=b.dataset.tv;saveSettings();render()});
  q('#sPill').onclick=()=>openChoice(t('pill_size'),t('pill_d'),[['s',pillL.s],['m',pillL.m],['l',pillL.l]],settings.pill||'m',v=>{settings.pill=v;saveSettings();document.documentElement.dataset.pill=v;render()});
  q('#sSafe').onclick=()=>setPriv(!settings.hidePrices);
  q('#sDeal').onclick=openDealSheet;
  q('#sNotif').onclick=async()=>{
    if(!notifOK)return;
    if(notifOn){settings.notif=false;saveSettings();render();return}
    try{if(Notification.permission!=='granted')await Notification.requestPermission()}catch(_){}
    if(Notification.permission==='granted'){settings.notif=true;saveSettings()}else toast(t('notif_blocked'));
    render();
  };
  q('#exJson').onclick=exportBackup;
  q('#exCsv').onclick=()=>{
    const cols=['name','setName','localId','official','lang','variant','cond','grade','cert','qty','status','buy','date','value','manual','notes'];
    const rows=collection.map(e=>cols.map(c=>{const v=c==='value'?(entryValue(e)??''):c==='grade'?gradeStr(e):c==='cert'?(e.grade?.cert||''):e[c]??'';let x=String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(x))x="'"+x;   // a text starting like a formula (=, +, -, @) would be run by Excel / Sheets (CSV injection)
      return '"'+x.replace(/"/g,'""')+'"'}).join(';'));
    download(`gleamvault-${today()}.csv`,'﻿'+cols.join(';')+'\n'+rows.join('\n'),'text/csv');
  };
  q('#imp').onchange=async ev=>{
    const file=ev.target.files[0];if(!file)return;ev.target.value='';
    try{
      if(file.size>40e6)throw 0;   // a real backup of 20 000 cards weighs ~25 MB: anything bigger is not one of ours
      const data=JSON.parse(await file.text());
      const list=Array.isArray(data)?data:data?.collection;
      if(!Array.isArray(list)||list.length>50000||list.some(e=>!e||typeof e!=='object'||!e.cardId||!e.name))throw 0;
      if(collection.length&&!(await confirmBox(t('import_confirm',{a:collection.length,b:list.length}))))return;
      const now=Date.now();collection.forEach(x=>{deleted[x.uid]=now});LS.set('pf_deleted',deleted);
      collection=cleanList(list.map(e=>Object.assign({uid:uid(),qty:1,status:'owned',variant:'normal',cond:'NM',lang:'fr',added:Date.now(),hist:[]},e,{upd:now+1})));
      if(Array.isArray(data.snapshots))snapshots=cleanSnaps(data.snapshots);
      LS.set('pf_snapshots',snapshots);saveCollection();toast(t('import_ok',{n:collection.length}));render();
    }catch(e){toast(t('import_bad'))}
  };
  q('#sManual').onclick=openManualList;
  q('#sNoImg').onclick=openNoImgList;
  q('#sRLog').onclick=openRefreshLog;
  q('#sELog').onclick=openErrLog;
  q('#tourAgain').onclick=()=>{location.hash='#collection';setTimeout(tourStart,250)};
  q('#clr').onclick=async()=>{idx.fr=idx.en=idx.ja=null;loading.fr=loading.en=loading.ja=null;await loadIndex(settings.cardLang,true).catch(()=>{});toast(t('cache_cleared'))};
}

/* ============ boot ============ */
initSupabase();
// fetch the charts library quietly once the app is up, so Valeur draws at once (from the cache on later launches)
addEventListener('load',()=>setTimeout(()=>{if(!saveData())loadChart().catch(()=>{})},4000),{once:true});
/* ============ guided tour (first launch, can be replayed from Settings) ============ */
const tour={i:0,steps:null,el:null,poll:null,n0:0};
function tourTarget(v){return (matchMedia('(max-width:720px)').matches?document.querySelector(`#tabbar a[href="#${v}"]`):document.querySelector(`#nav a[href="#${v}"]`))}
function tourEnd(goColl){
  clearInterval(tour.poll);tour.poll=null;flagSet('pf_tour',1);
  tour.el?.remove();tour.el=null;window.removeEventListener('resize',tourPlace);document.getElementById('main').removeEventListener('scroll',tourPlace);
  if(goColl)location.hash='#collection';
}
function tourStart(){
  tour.steps=[
    {welcome:true},
    {v:'collection',k:'tour_coll'},{v:'add',k:'tour_add'},{v:'wishlist',k:'tour_wish'},{v:'evolution',k:'tour_value'},{v:'collection',k:'tour_safe',tg:'#privBtn'},{v:'data',k:'tour_set'},
    {try:'pick'},{try:'search'},{try:'add'},{done:true}];
  tour.i=0;tour.el?.remove();
  tour.el=document.createElement('div');tour.el.className='tour';
  tour.el.innerHTML='<div class="tour-block"></div><div class="tour-ring"></div><div class="tour-bub" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(tour.el);
  window.addEventListener('resize',tourPlace);document.getElementById('main').addEventListener('scroll',tourPlace,{passive:true});
  tourShow();
}
function tourShow(){
  const s=tour.steps[tour.i],b=tour.el.querySelector('.tour-bub'),total=tour.steps.filter(x=>x.v).length;
  clearInterval(tour.poll);tour.poll=null;
  const skip=`<button class="linkbtn" data-tskip>${t('tour_skip')}</button>`;
  tour.el.classList.toggle('free',!!s.try);tour.el.classList.toggle('center',!!(s.welcome||s.done));
  if(s.welcome){
    b.innerHTML=`<div class="tour-logo">${document.querySelector('.logo svg')?.outerHTML||''}</div><h2>${t('tour_hi')}</h2><p>${t('tour_hi_d')}</p><div class="tour-btns">${skip}<button class="btn primary" data-tnext>${t('tour_go')}</button></div>`;
  }else if(s.v){
    if(s.tg&&location.hash!=='#'+s.v){location.hash='#'+s.v;setTimeout(tourPlace,350)}
    const n=tour.i;b.innerHTML=`<div class="tour-step">${n} / ${total}</div><p>${t(s.k)}</p><div class="tour-btns">${skip}<button class="btn primary" data-tnext>${t(n===total?'tour_try':'tour_next')}</button></div>`;
  }else if(s.try==='pick'){
    if(location.hash!=='#add')location.hash='#add';
    b.innerHTML=`<div class="tour-step">${t('tour_trial')}</div><p>${t('tour_pick')}</p><div class="tour-btns">${skip}<button class="btn primary" data-tnext>${t('tour_next')}</button></div>`;
    setTimeout(tourPlace,350);   // Ajouter is drawn after the hash change
  }else if(s.try==='search'){
    if(location.hash!=='#add')location.hash='#add';
    b.innerHTML=`<div class="tour-step">${t('tour_trial')}</div><p>${t('tour_search')}</p><div class="tour-btns">${skip}</div>`;
    tour.n0=collection.filter(x=>x.status!=='wish').reduce((a,x)=>a+(x.qty||1),0);
    tour.poll=setInterval(()=>{if(document.querySelector('#sgrid .tile')){tour.i++;tourShow()}},400);
  }else if(s.try==='add'){
    b.innerHTML=`<div class="tour-step">${t('tour_trial')}</div><p>${t('tour_addit')}</p><div class="tour-btns">${skip}</div>`;
    tour.poll=setInterval(()=>{const n=collection.filter(x=>x.status!=='wish').reduce((a,x)=>a+(x.qty||1),0);if(n>tour.n0){tour.i++;tourShow()}else if(!document.querySelector('#sgrid .tile')&&!document.getElementById('ov')){tour.i--;tourShow()}else tourPlace()},400);
  }else if(s.done){
    b.innerHTML=user?`<div class="tour-logo big">🎉</div><h2>${t('tour_bravo')}</h2><p>${t('tour_bravo_u')}</p><div class="tour-btns"><button class="btn primary" data-tend>${t('tour_end')}</button></div>`
      :`<div class="tour-logo big">🎉</div><h2>${t('tour_bravo')}</h2><p>${t('tour_bravo_d')}</p><div class="tour-col"><button class="btn primary" data-tacc>${t('tour_acc')}</button><button class="btn" data-tend>${t('tour_local')}</button></div><p class="tour-note">${t('tour_local_d')}</p>`;
  }
  b.querySelector('[data-tskip]')?.addEventListener('click',()=>tourEnd(false));
  b.querySelector('[data-tnext]')?.addEventListener('click',()=>{tour.i++;tourShow()});
  b.querySelector('[data-tend]')?.addEventListener('click',()=>tourEnd(true));
  b.querySelector('[data-tacc]')?.addEventListener('click',()=>{tourEnd(true);setTimeout(openAccount,250)});
  requestAnimationFrame(tourPlace);
}
function tourPlace(){
  if(!tour.el)return;
  const s=tour.steps[tour.i],ring=tour.el.querySelector('.tour-ring'),b=tour.el.querySelector('.tour-bub');
  let tg=null;
  if(s.tg)tg=document.querySelector(s.tg);
  else if(s.v)tg=tourTarget(s.v);
  else if(s.try==='pick')tg=document.querySelector('.add-top');
  else if(s.try==='search')tg=(document.querySelector('#sq')||document.querySelector('#mq'))?.closest('.searchbox');
  else if(s.try==='add')tg=document.getElementById('ov')?null:document.querySelector('#sgrid .tile');
  if(!tg){ring.style.display='none';const bw=Math.min(320,innerWidth-24);b.style.cssText=tour.el.classList.contains('center')?'':`left:${(innerWidth-bw)/2}px;width:${bw}px;bottom:${matchMedia('(max-width:720px)').matches?96:24}px`;b.dataset.arrow='';return}   // centred cards: no bottom, or top+bottom would squeeze the card
  const r=tg.getBoundingClientRect(),pad=6;
  const rl=Math.max(2,r.left-pad),rr=Math.min(innerWidth-2,r.right+pad);   // keep the ring inside the screen (tabs at the edges)
  ring.style.cssText=`display:block;left:${rl}px;top:${r.top-pad}px;width:${rr-rl}px;height:${r.height+pad*2}px`;
  const bw=Math.min(320,innerWidth-24);b.style.cssText=`left:12px;top:0;width:${bw}px;visibility:hidden`;const bh=b.offsetHeight||160,below=r.bottom+16+bh<innerHeight;
  const x=Math.max(12,Math.min(innerWidth-bw-12,r.left+r.width/2-bw/2));
  b.style.cssText=`left:${x}px;width:${bw}px;${below?`top:${r.bottom+14}px`:`top:${Math.max(12,r.top-bh-18)}px`}`;
  b.dataset.arrow=below?'up':'down';b.style.setProperty('--ax',(r.left+r.width/2-x)+'px');
}

/* ============ manual cards: brand-new cards not yet in the TCGdex database ============ */
const MANUAL_DAYS=60;
const manualCards=()=>collection.filter(e=>e.manualCard);
const manualMatches={}; // uid -> TCGdex card id found for it
function manualStale(){const lim=Date.now()-MANUAL_DAYS*864e5;return manualCards().filter(e=>!manualMatches[e.uid]&&(e.keepSince||e.added||0)<lim)}
// look for the real card: same set + same number, or same name + same number
function matchManual(lang){
  const data=idx[lang];if(!data)return 0;let n=0;
  for(const e of manualCards()){
    if(e.lang!==lang||manualMatches[e.uid])continue;
    const num=parseInt(e.localId,10),nm=norm(e.name);
    const c=data.cards.find(c=>parseInt(c.l,10)===num&&((e.setId&&c.s===e.setId)||(c.k||(c.k=norm(c.n)))===nm)&&c.id!==e.dismissMatch);
    if(c){manualMatches[e.uid]=c.id;n++}
  }
  return n;
}
async function linkManual(uids){
  let ok=0;
  for(const u of uids){
    const e=collection.find(x=>x.uid===u),cid=manualMatches[u];if(!e||!cid)continue;
    try{
      const d=await getDetail(e.lang,cid);
      const variant=d.variants?.[e.variant]?e.variant:(VARIANTS.find(v=>d.variants?.[v])||e.variant);
      Object.assign(e,{cardId:cid,name:d.name,setId:d.set?.id,setName:setNameFor(e.lang,d.set),localId:String(d.localId),official:d.set?.cardCount?.official||null,rarity:d.rarity||'',image:d.image||'',variant,price:pickPrice(d.pricing,variant,d.variants?.normal),tcp:d.pricing?.tcgplayer||null,upd:Date.now()});
      delete e.manualCard;delete e.keepSince;delete e.dismissMatch;delete manualMatches[u];pushHistory(e);ok++;
    }catch(_){}
  }
  if(ok){saveCollection();render();toast(t('man_linked',{n:ok}))}else toast(t('err_net'));
}
// Backup reminder for people without an account: their collection only lives on this device. From 50 cards, then monthly:
// « Create a free account » / « Export a backup » / « Later » (30 days). An account or an export stops it.
const BACKUP_MIN=50,BACKUP_EVERY=30*864e5;
function exportBackup(){download(`gleamvault-${today()}.json`,JSON.stringify({app:'gleamvault',version:1,exported:new Date().toISOString(),collection,snapshots},null,1),'application/json');settings.lastBackup=Date.now();saveSettings();document.getElementById('bkBan')?.remove()}
const hasSavedSession=()=>{try{return Object.keys(localStorage).some(k=>/^sb-.+-auth-token$/.test(k))}catch(e){return false}};
const backupDue=()=>authKnown&&!user&&!hasSavedSession()&&!SHARED_TOKEN&&collection.length>=BACKUP_MIN&&Date.now()-Math.max(settings.lastBackup||0,settings.backupLater||0)>BACKUP_EVERY;
function backupBanner(){
  if(!backupDue())return '';
  return `<div class="man-ban bk-ban" id="bkBan"><span>💾 ${t('bk_text',{n:totals(collection.filter(e=>e.status!=='wish')).count})}</span><span class="bk-acts"><button class="btn btn-sm primary" id="bkAcc">${t('bk_account')}</button><button class="btn btn-sm" id="bkExp">${t('bk_export')}</button><button class="btn btn-sm ghost" id="bkLater">${t('bk_later')}</button></span></div>`;
}
function bindBackupBanner(m){
  const b=m.querySelector('#bkBan');if(!b)return;
  b.querySelector('#bkAcc').onclick=()=>openAccount();
  b.querySelector('#bkExp').onclick=exportBackup;
  b.querySelector('#bkLater').onclick=()=>{settings.backupLater=Date.now();saveSettings();b.remove()};
}
function manualBanner(){
  const found=manualCards().filter(e=>manualMatches[e.uid]),stale=manualStale();
  return (found.length?`<div class="man-ban ok"><span>🔗 ${t('man_found',{n:found.length})}</span><button class="btn btn-sm primary" id="manLink">${t('man_link_btn')}</button></div>`:'')
    +(stale.length?`<div class="man-ban"><span>⏳ ${t('man_stale',{n:stale.length,d:MANUAL_DAYS})}</span><button class="btn btn-sm" id="manCheck">${t('man_check')}</button></div>`:'');
}
function bindManualBanner(m){
  bindBackupBanner(m);
  const a=m.querySelector('#manLink');if(a)a.onclick=()=>linkManual(manualCards().filter(e=>manualMatches[e.uid]).map(e=>e.uid));
  const b=m.querySelector('#manCheck');if(b)b.onclick=openManualList;
}
// cards of the collection / wishlist whose picture could not be found anywhere (measured as they are displayed)
const noImgCards=()=>collection.filter(e=>!e.manualCard&&noImg.has(`${e.lang}|${e.setId}|${e.localId}`));
function openNoImgList(){
  const list=noImgCards();
  const txt=list.map(e=>`${e.name} · ${e.setName||e.setId} · ${e.localId}${e.official?'/'+e.official:''} (${(LANG_NAMES[e.lang]||e.lang)})`).join('\n');
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">${t('ni_title')}</h2><p class="muted small" style="margin:0 0 12px">${t('ni_d')}</p>
    ${list.length?list.map(e=>`<button type="button" class="man-row ni-row" data-ni="${e.uid}"><span class="lflag">${FLAGS[e.lang]||''}</span><span class="t"><b>${esc(e.name)}</b><span>${esc(e.setName||e.setId)} · ${esc(numLabel(e.localId,e.official))}</span></span></button>`).join('')
      +`<button class="btn" id="niCopy" style="width:100%;justify-content:center;margin-top:14px">${t('ni_copy')}</button>`
      :`<p class="muted">${t('ni_none')}</p>`}</div>`,'sm');
  m.querySelectorAll('[data-ni]').forEach(b=>b.onclick=()=>{closeModal();setTimeout(()=>openEntry(b.dataset.ni),60)});
  const cp=m.querySelector('#niCopy');if(cp)cp.onclick=async()=>{try{await navigator.clipboard.writeText(txt);toast(t('ni_copied',{n:list.length}))}catch(_){toast(t('err_net'))}};
}
function openErrLog(){
  const log=LS.get('pf_errlog',[]).filter(r=>obj(r)&&Number.isFinite(r.t)&&Math.abs(r.t)<8.64e15);
  const txt=log.map(r=>`${new Date(r.t).toISOString().slice(0,16).replace('T',' ')} v${r.v} ${r.h||''} — ${r.m}${r.s?' ('+r.s+')':''}`).join('\n');
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">${t('el_title')}</h2><p class="muted small" style="margin:0 0 12px">${t('el_d')}</p>
    ${log.length?`<pre class="el-pre">${esc(txt)}</pre><div class="row" style="gap:8px;margin-top:12px"><button class="btn primary" id="elCopy" type="button">${t('el_copy')}</button><button class="btn" id="elClear" type="button">${t('el_clear')}</button></div>`:`<p class="muted">${t('el_none')}</p>`}</div>`,'sm');
  m.querySelector('#elCopy')?.addEventListener('click',()=>{navigator.clipboard?.writeText(txt).then(()=>toast(t('el_copied')),()=>{})});
  m.querySelector('#elClear')?.addEventListener('click',()=>{LS.set('pf_errlog',[]);closeModal();render()});
}
function openRefreshLog(){
  // journal kept on the device: only well-formed lines (numbers forced), a damaged or tampered entry is skipped
  const N=v=>Number.isFinite(+v)?+v:0,log=LS.get('pf_rlog',[]).filter(r=>obj(r)&&Number.isFinite(r.ts)&&Math.abs(r.ts)<8.64e15).map(r=>({ts:r.ts,a:N(r.a),b:N(r.b),n:N(r.n)|0,f:N(r.f)|0,m:Array.isArray(r.m)?r.m.filter(obj).map(x=>({n:String(x.n??''),s:String(x.s??''),a:N(x.a),b:N(x.b),sa:/^\w{0,20}$/.test(x.sa)?x.sa:'',sb:/^\w{0,20}$/.test(x.sb)?x.sb:''})):[]})),hp=settings.hidePrices,src=s=>{const k='rl_s_'+(s||'none'),v=t(k);return v===k?t('rl_s_none'):v};
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">${t('rl_title')}</h2><p class="muted small" style="margin:0 0 12px">${t(hp?'rl_safe':'rl_d')}</p>
    ${log.length?log.map(r=>`<div class="rl-item"><div class="rl-h"><b>${fmtDate(new Date(r.ts).toISOString().slice(0,10))} ${new Date(r.ts).toTimeString().slice(0,5)}</b><span class="money">${fmtEur(r.a)} → ${fmtEur(r.b)}</span></div>
      <div class="muted small">${t('rl_cards',{n:r.n})}${r.f?' · '+t('rl_failed',{n:r.f}):''}</div>
      ${hp?'':r.m.length?r.m.map(x=>`<div class="rl-row"><span class="t">${esc(x.n)}<small>${esc(x.s)}</small></span><span class="money small">${fmtEur(x.a)} → ${fmtEur(x.b)}<small>${src(x.sa)}${x.sa!==x.sb?' → '+src(x.sb):''}</small></span></div>`).join(''):`<div class="muted small">${t('rl_nomove')}</div>`}</div>`).join(''):`<p class="muted">${t('rl_none')}</p>`}</div>`,'sm');
}
function openManualList(){
  const list=manualCards();
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">${t('man_list')}</h2><p class="muted small" style="margin:0 0 12px">${t('man_list_d',{d:MANUAL_DAYS})}</p>
    ${list.length?list.map(e=>{const age=Math.floor((Date.now()-(e.added||Date.now()))/864e5),stale=manualStale().includes(e);
      return `<div class="man-row"><div class="t"><b>${esc(e.name)}</b><span>${esc(e.setName||t('man_noset'))} · ${esc(e.localId)} · ${t('man_age',{n:age})}${stale?' · ⏳':''}</span></div>
      ${manualMatches[e.uid]?`<button class="btn btn-sm primary" data-mlink="${e.uid}">🔗 ${t('man_link_one')}</button>`:stale?`<button class="btn btn-sm" data-mkeep="${e.uid}">${t('man_keep')}</button>`:''}
      <button class="sh-edit sh-del" data-mdel="${e.uid}" aria-label="${esc(t('delete'))}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/></svg></button></div>`}).join('')
      :`<p class="muted">${t('man_none')}</p>`}
    <button class="btn primary" id="manNew" style="width:100%;justify-content:center;margin-top:14px">＋ ${t('man_add')}</button></div>`,'sm');
  m.querySelectorAll('[data-mlink]').forEach(b=>b.onclick=()=>{closeModal();linkManual([b.dataset.mlink])});
  m.querySelectorAll('[data-mkeep]').forEach(b=>b.onclick=()=>{const e=collection.find(x=>x.uid===b.dataset.mkeep);e.keepSince=Date.now();e.upd=Date.now();saveCollection();render();closeModal();openManualList()});
  m.querySelectorAll('[data-mdel]').forEach(b=>b.onclick=()=>{const e=collection.find(x=>x.uid===b.dataset.mdel);if(!e)return;deleted[e.uid]=Date.now();LS.set('pf_deleted',deleted);collection=collection.filter(x=>x!==e);saveCollection();render();closeModal();openManualList();
    toast(t('deleted_n',{n:e.name}),{label:t('undo'),fn:()=>{delete deleted[e.uid];LS.set('pf_deleted',deleted);e.upd=Date.now();collection.push(e);saveCollection();render()}})});
  m.querySelector('#manNew').onclick=()=>openManualForm();
}
// prefill from the search that found nothing: words → name, a number → card number, a set code (e.g. "MEP") → set
function openManualForm(pref={}){
  const lang=pref.lang||settings.cardLang,data=idx[lang];
  const sets=data?Object.values(data.sets).sort((a,b)=>b.o-a.o):[];
  let name=pref.name||'',num=pref.num||'',set=pref.set||'';
  if(pref.q){const toks=pref.q.trim().split(/\s+/);const rest=[];
    for(const w of toks){const nw=norm(w);if(/^\d+(\/\d+)?$/.test(w)){num=w.split('/')[0]}else if(!set&&sets.some(s=>s.id===nw)){set=nw}else rest.push(w)}
    name=rest.join(' ')}
  const m=openModal(`<div class="mpad"><h2 style="margin:0 40px 4px 0">${t('man_add')}</h2><p class="muted small" style="margin:0 0 6px">${t('man_form_d')}</p>
    <form class="sh-form" id="manForm">
      <div class="sh-lbl">${t('man_name')} *</div><input maxlength="300" type="text" name="name" required value="${esc(name)}" placeholder="Kyogre">
      <div class="sh-lbl">${t('set')}</div><select name="set"><option value="">${t('man_set_other')}</option>${sets.map(s=>`<option value="${esc(s.id)}" ${s.id===set?'selected':''}>${esc(s.n)}</option>`).join('')}</select>
      <input maxlength="300" type="text" name="setName" placeholder="${esc(t('man_set_name'))}" style="margin-top:8px;${set?'display:none':''}">
      <div class="sh-lbl">${t('man_num')} *</div><input maxlength="20" type="text" name="num" required value="${esc(num)}" placeholder="117" inputmode="numeric">
      <div class="sh-lbl">${t('variant')}</div>${pickSeg('variant',[['normal',t('v_normal')],['reverse',t('v_reverse')],['holo',t('v_holo')]],'normal')}
      <div class="sh-lbl">${t('condition')}</div>${pickPills('cond','NM')}
      <div class="sh-lbl">${t('qty')}</div>${pickQty(1)}
      <div class="sh-lbl money">${t('man_value')}</div><input max="10000000" class="money" type="number" name="manual" min="0" step="0.01" inputmode="decimal" placeholder="${esc(t('man_value_ph'))}">
      <p class="muted small" style="margin:12px 0 0">${t('man_note')}</p>
      <div class="sh-edbtns"><button type="submit" class="btn" value="wish">♡ ${t('cta_wish')}</button><span></span><button type="submit" class="btn primary" value="owned">＋ ${t('add_btn')}</button></div>
    </form></div>`,'sm');
  const f=m.querySelector('#manForm');bindPickers(f);
  f.set.onchange=()=>{f.setName.style.display=f.set.value?'none':''};
  f.onsubmit=ev=>{
    ev.preventDefault();
    const st=sets.find(s=>s.id===f.set.value),nm=f.name.value.trim(),no=f.num.value.trim().replace(/^#/,'');
    if(!nm||!no)return;
    const e={uid:uid(),cardId:'manual-'+uid(),manualCard:true,lang,name:nm,setId:st?.id||'',setName:st?.n||f.setName.value.trim(),localId:no,official:st?.off||null,rarity:'',image:'',
      variant:f.variant.value,cond:f.cond.value,qty:Math.max(1,parseInt(f.qty.value)||1),buy:0,date:today(),status:ev.submitter?.value==='wish'?'wish':'owned',notes:'',
      manual:parseFloat(String(f.manual.value).replace(',','.'))||0,added:Date.now(),price:null,hist:[],upd:Date.now()};
    collection.push(e);saveCollection();closeModal();render();toast(t('man_added',{n:nm}));
    if(idx[lang]&&matchManual(lang))render();
  };
}
// at start-up (during the splash): load the card database of the search language, so Ajouter opens instantly,
// and of the manual cards' languages, to check them against it
setTimeout(()=>collReady.then(()=>{const L=new Set([settings.cardLang,...manualCards().map(e=>e.lang)]);L.forEach(l=>loadIndex(l).then(()=>{if(manualCards().some(e=>e.lang===l)&&matchManual(l))render()}).catch(()=>{}))}),300);

// first screen once the collection is read from IndexedDB (a few ms, hidden by the intro)
route();collReady.then(route);
setTimeout(()=>{if(!SHARED_TOKEN&&!document.getElementById('tabbar').innerHTML){logErr('start-up watchdog: nothing drawn after 6 s','boot');try{route()}catch(e){logErr(e.message,'watchdog route')}}},6000);
setTimeout(refreshFx,1500);   // dollar → euro rate of the day
// splash: fade out once the first screen is drawn (kept at least 700 ms so it doesn't flash)
// full intro (~2 s) unless the device asks for reduced motion; a tap or a key skips it
{const t0=performance.timing?.navigationStart||Date.now(),sp=document.getElementById('splash');
 if(sp){const min=matchMedia('(prefers-reduced-motion: reduce)').matches?700:2250;let done=false;
  const hide=()=>{if(done)return;done=true;sp.classList.add('out');{const tc=document.querySelector('meta[name=theme-color]');if(tc)tc.content='#0f1117'}setTimeout(()=>sp.remove(),600)};
  sp.addEventListener('pointerdown',hide);addEventListener('keydown',hide,{once:true});
  // after the intro, wait for the first sync of the account (at most 1 s more) so the collection shows up to date
  const minWait=new Promise(r=>setTimeout(r,Math.max(0,min-(Date.now()-t0))));
  minWait.then(()=>Promise.race([bootSync,new Promise(r=>setTimeout(r,1000))])).then(hide)}}
// first launch: welcome + guided tour (only on a fresh device with an empty collection)
const NEWS_ID=2;   // bump to show the « Quoi de neuf ? » sheet once more to existing users
function openNews(){
  flagSet('pf_news',NEWS_ID);
  const it=(ic,k)=>`<div class="news-it"><span class="news-ic">${ic}</span><p>${t(k)}</p></div>`;
  const m=openModal(`<div class="mpad news"><h2 style="margin:0 40px 12px 0">✨ ${t('news_t')}</h2>${it(gdot('op'),'news_op')}${it('<span class="news-e">€</span>','news_fx')}${it('<span class="news-e">⌕</span>','news_noimg')}
    <div class="news-btns"><button class="btn" id="nwOk">${t('news_ok')}</button><button class="btn primary" id="nwTry">${t('news_try_op')}</button></div></div>`,'sm');
  m.querySelector('#nwOk').onclick=()=>closeModal();
  m.querySelector('#nwTry').onclick=()=>{settings.game='op';saveSettings();closeModal();setTimeout(()=>{location.hash='#add';render()},60)};
}
setTimeout(()=>Promise.all([collReady,flagsReady]).then(()=>{if(SHARED_TOKEN)return;if(!LS.get('pf_tour',0)&&!collection.length&&!user){flagSet('pf_news',NEWS_ID);tourStart()}else{flagSet('pf_tour',1);if((+LS.get('pf_news',0)||0)<NEWS_ID&&!document.getElementById('ov'))openNews()}}),1400);
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
/* ============ updates: the app opens from the cache, so it checks itself whether a newer version is online ============
   - newer version → discreet bar « Update » (one tap reloads), checked at launch, on return to the foreground, every 6 h;
   - back in the foreground after 5+ min away with nothing open or being typed → updated automatically;
   - online MIN_VERSION above this app → blocking screen, syncing stopped (protects data after a format change). */
let updBlocked=false,updReady=null,updLast=0,hiddenAt=0;
const verKey=v=>String(v||'').split(/[.-]/).map(n=>+n||0);
const verCmp=(a,b)=>{const x=verKey(a),y=verKey(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d<0?-1:1}return 0};
async function checkUpdate(force){
  if(SHARED_TOKEN||!/^https?:$/.test(location.protocol)&&!window.__updTest)return;
  if(!force&&Date.now()-updLast<10*60*1000)return;updLast=Date.now();
  let html;try{const r=await fetch((window.__updTest||'index.html')+'?check='+Date.now(),{cache:'no-store'});if(!r.ok)return;html=await r.text()}catch(e){return}
  const v=(html.match(/name="app-version" content="([^"]+)"/)||html.match(/APP_VERSION = '([^']+)'/)||[])[1],mv=(html.match(/name="app-min-version" content="([^"]+)"/)||html.match(/MIN_VERSION = '([^']+)'/)||[])[1];
  if(!v||verCmp(v,APP_VERSION)<=0)return;
  updReady=html;
  if(mv&&verCmp(APP_VERSION,mv)<0)return showForceUpdate();
  showUpdateBar();
}
async function applyUpdate(){
  // the service worker serves the cached page: store the new one there first, so the reload shows it right away.
  // Its code files (app.js?v=…, boot.js?v=…) go in first: the cached page must never point to a file that is not there (offline).
  try{if(updReady&&window.caches){const k=(await caches.keys()).find(n=>n.startsWith('gleamvault-'));if(k){const c=await caches.open(k);
    const srcs=[...updReady.matchAll(/<script src="([^"]+)"/g)].map(m=>new URL(m[1],location.href).href);
    for(const u of srcs){const r=await fetch(u);if(!r.ok)throw new Error('script '+r.status);await c.put(u,r)}
    await c.put(new URL('index.html',location.href).href,new Response(updReady,{headers:{'content-type':'text/html; charset=utf-8'}}))}}}catch(e){logErr(e.message,'update')}
  try{sessionStorage.setItem('pf_updreload','1')}catch(e){}
  location.reload();
}
function showUpdateBar(){
  if(document.querySelector('.upd-bar'))return;
  const b=document.createElement('div');b.className='upd-bar';b.setAttribute('role','status');
  b.innerHTML=`<span>${t('upd_avail')}</span><button type="button" class="upd-go">${t('upd_btn')}</button><button type="button" class="upd-x" aria-label="✕">✕</button>`;
  b.querySelector('.upd-go').onclick=applyUpdate;b.querySelector('.upd-x').onclick=()=>b.remove();
  document.body.appendChild(b);
}
function showForceUpdate(){
  updBlocked=true;if(document.querySelector('.upd-force'))return;
  const f=document.createElement('div');f.className='upd-force';f.setAttribute('role','alertdialog');
  f.innerHTML=`<div><div style="font-size:40px">🔄</div><h2>${t('upd_force_t')}</h2><p>${t('upd_force_d')}</p><button type="button">${t('upd_btn')}</button><p class="small upd-off" style="margin-top:14px" hidden>${t('upd_force_off')}</p></div>`;
  f.querySelector('button').onclick=()=>{if(navigator.onLine===false){f.querySelector('.upd-off').hidden=false;return}applyUpdate()};
  document.body.appendChild(f);
}
const updQuiet=()=>!document.getElementById('ov')&&!document.querySelector('.tour')&&!document.getElementById('splash')&&!(document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='hidden'){hiddenAt=Date.now();return}
  const away=hiddenAt&&Date.now()-hiddenAt>5*60*1000;hiddenAt=0;
  await checkUpdate(away);
  // not in the middle of the return-to-app animation: the phone may still be resizing the window
  if(away&&updReady&&!updBlocked&&updQuiet())setTimeout(()=>{if(document.visibilityState==='visible'&&updQuiet())applyUpdate()},1500);
});
// phone layout guard: the tab bar must sit inside the visible area. If the browser sized the page taller than the screen
// (seen on Android after an in-app reload), fit the page to the visible height and note it in the error journal.
function fitLayout(why){
  const tb=document.getElementById('tabbar');if(!tb||getComputedStyle(tb).display==='none'||document.visibilityState!=='visible')return;
  const vv=window.visualViewport;
  // the keyboard and pinch-zoom shrink the visible area on purpose: leave the page alone
  if(vv&&vv.scale>1.01||document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))return;
  const vh=Math.round(Math.min(innerHeight,vv?vv.height+vv.offsetTop:innerHeight)),r=tb.getBoundingClientRect();
  if(r.bottom>vh+2){document.body.style.height=vh+'px';logErr(`layout fixed (${why}): tab bar ${Math.round(r.top)}-${Math.round(r.bottom)}, visible ${vh}, inner ${innerHeight}, screen ${screen.height}/${screen.availHeight}`,'layout')}
  else if(document.body.style.height&&Math.abs(parseFloat(document.body.style.height)-vh)>2)document.body.style.height='';
}
['resize','pageshow','orientationchange'].forEach(e=>addEventListener(e,()=>setTimeout(()=>fitLayout(e),250)));
window.visualViewport?.addEventListener('resize',()=>setTimeout(()=>fitLayout('vv'),250));
document.addEventListener('visibilitychange',()=>setTimeout(()=>fitLayout('visible'),600));
setTimeout(()=>fitLayout('start'),1200);setTimeout(()=>fitLayout('start2'),3500);
setTimeout(()=>checkUpdate(true),8000);setInterval(()=>checkUpdate(true),6*3600*1000);
loadIndex(settings.cardLang).then(()=>{if(syncEntrySetNames()&&!document.querySelector('.ov'))render()}).catch(()=>{});
const autoRefresh=()=>{if(collection.length&&!saveData()&&navigator.onLine!==false&&Date.now()-settings.lastRefresh>AUTO_REFRESH)refreshPrices(true)};
collReady.then(autoRefresh);addEventListener('online',()=>setTimeout(autoRefresh,1500));
