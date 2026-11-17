/* Interface languages: English (the source text) and French. The English sentence is the key, so the code stays readable:
     t("Create event")                      -> "Créer l'événement" in French
     t("Could not add: {m}", { m: err })    -> {name} placeholders
     tn(n, "{n} vote", "{n} votes", {})     -> singular/plural (French counts 0 and 1 as singular)
   A sentence with no French entry shows in English (and is listed in I18n.missing for the tests). The language is the browser's
   (French if it starts with fr) unless the visitor chose one with the EN | FR switch; the choice is remembered. */
(function (root) {
  "use strict";
  const FR = {
    // ---- page (index.php) ----
    "Find the fairest place to meet in Île-de-France": "Trouvez le lieu de rendez-vous le plus équitable en Île-de-France",
    "Metro, RER, train and tram, plus buses when enabled. Times are estimates from average timetables, not live.": "Métro, RER, train et tramway, plus les bus si activés. Les temps sont des estimations à partir d'horaires moyens, pas en temps réel.",
    "Data: Île-de-France Mobilités, OpenStreetMap contributors (ODbL), adresse.data.gouv.fr.": "Données : Île-de-France Mobilités, contributeurs OpenStreetMap (ODbL), adresse.data.gouv.fr.",
    "The page updates itself when a new version is installed.": "La page se met à jour toute seule quand une nouvelle version est installée.",
    "Reload everything": "Tout recharger",
    "if something still looks broken.": "si quelque chose semble encore cassé.",
    "Re-download every file of the app and its map data, then reload. Your events and organizer keys are kept.": "Retélécharge tous les fichiers de l'application et de la carte, puis recharge. Vos événements et clés d'organisateur sont conservés.",
    "Play or pause": "Lecture ou pause", "Time": "Temps", "Direction": "Sens", "Speed": "Vitesse",
    "Going": "Aller", "Coming back": "Retour", "Language": "Langue",
    "Data © Île-de-France Mobilités, OpenStreetMap contributors": "Données © Île-de-France Mobilités, contributeurs OpenStreetMap",
    // ---- modes, objectives, what to meet at ----
    "Walk": "Marche", "Transit": "Transports", "Bike": "Vélo", "Car": "Voiture",
    "Fairest": "Le plus équitable", "Fastest overall": "Le plus rapide au total", "Balanced": "Équilibré",
    "Nobody travels far: minimizes the longest trip (going or coming back).": "Personne ne voyage longtemps : minimise le trajet le plus long (aller ou retour).",
    "Least total travel time for the whole group.": "Temps de trajet total le plus faible pour tout le groupe.",
    "Minimizes the root-mean-square of the trip times: a compromise that punishes long trips.": "Minimise la moyenne quadratique des temps de trajet : un compromis qui pénalise les longs trajets.",
    "Stations": "Stations", "Restaurants": "Restaurants", "Cafés": "Cafés", "Bars": "Bars", "Parks": "Parcs", "Culture": "Culture", "Sights": "Lieux à voir",
    "Station": "Station", "Restaurant": "Restaurant", "Café": "Café", "Bar": "Bar", "Park": "Parc", "Sight": "Lieu à voir", "Place": "Lieu",
    "museum": "musée", "gallery": "galerie", "theatre": "théâtre", "cinema": "cinéma", "arts centre": "centre d'arts", "library": "bibliothèque", "music venue": "salle de concert",
    "attraction": "attraction", "viewpoint": "point de vue", "castle": "château", "monument": "monument", "ruins": "ruines", "fort": "fort", "archaeological site": "site archéologique",
    "bus stop": "arrêt de bus", "station": "station",
    "Metro, RER, train, tram": "Métro, RER, train, tramway", "Roads": "Routes", "Bus lines": "Lignes de bus",
    // ---- settings ----
    "Optimize for": "Optimiser pour", "Meet at": "Lieu de rendez-vous", "Day": "Jour", "Weekday": "Semaine", "Weekend": "Week-end",
    "A metro, RER, train or tram station.": "Une station de métro, RER, train ou tramway.",
    "Tick any mix. Stations are the quickest for public transport; other places add a walk from the nearest stop (up to 15 min), while people on foot, by bike or by car go straight there. Results are at least 500 m apart.": "Cochez ce que vous voulez. Les stations sont les plus rapides en transports ; les autres lieux ajoutent une marche depuis l'arrêt le plus proche (jusqu'à 15 min), tandis que les personnes à pied, à vélo ou en voiture s'y rendent directement. Les résultats sont distants d'au moins 500 m.",
    "Include buses in trips": "Inclure les bus dans les trajets", "Loads more data, a bit slower": "Charge plus de données, un peu plus lent",
    "Longest trip allowed:": "Trajet maximal autorisé :", "no limit": "sans limite",
    "Only the organizer can change these.": "Seul l'organisateur peut les modifier.", "Settings": "Réglages",
    // ---- home ----
    "Plan a meet-up": "Organiser une rencontre", "Event name": "Nom de l'événement", "Friday dinner": "Dîner du vendredi", "Meet-up": "Rencontre", "Create event": "Créer l'événement",
    "You get a link to send around. Everyone who opens it adds their own position, and the best meeting point updates live.": "Vous obtenez un lien à partager. Chaque personne qui l'ouvre ajoute sa position, et le meilleur lieu de rendez-vous se met à jour en direct.",
    "Your events": "Vos événements", "organizer": "organisateur", "guest": "invité",
    // ---- event page ----
    "← All events": "← Tous les événements", "Invite people": "Inviter des personnes",
    "Send this link. Everyone who opens it adds their own position.": "Envoyez ce lien. Chaque personne qui l'ouvre ajoute sa position.",
    "Copy invite link": "Copier le lien d'invitation", "Copy organizer link": "Copier le lien organisateur",
    "Open this on another device to stay organizer. Keep it private.": "Ouvrez-le sur un autre appareil pour rester organisateur. Gardez-le privé.",
    "Link copied.": "Lien copié.", "Select the link and copy it (Cmd/Ctrl+C).": "Sélectionnez le lien et copiez-le (Cmd/Ctrl+C).",
    "People": "Personnes", "Best meeting points": "Meilleurs lieux de rendez-vous", "Delete this event": "Supprimer cet événement", "Delete this event for everyone?": "Supprimer cet événement pour tout le monde ?",
    "Nobody yet. Add the first position below.": "Personne pour l'instant. Ajoutez la première position ci-dessous.",
    "you": "vous", "Edit": "Modifier", "Done": "Terminé", "Remove": "Retirer", "Remove this person": "Retirer cette personne", "Remove this entry": "Supprimer cette entrée",
    "Name": "Nom", "Starts from": "Part de", "Goes back to": "Rentre à", "Where from": "Départ", "Travels by": "Se déplace en",
    "Different address for the way back": "Adresse différente pour le retour",
    "Weight in \"Fastest overall\" and \"Balanced\"": "Poids dans « Le plus rapide au total » et « Équilibré »",
    "You can also drag the pins on the map.": "Vous pouvez aussi déplacer les repères sur la carte.",
    " (way back)": " (retour)", " · way back": " · retour",
    // ---- adding a person, addresses ----
    "Add your position": "Ajouter votre position", "Add someone else": "Ajouter quelqu'un d'autre", "Your name": "Votre nom", "Their name": "Son nom", "Add to the event": "Ajouter à l'événement",
    "This event is full (10 people).": "Cet événement est complet (10 personnes).",
    "Type an address in Île-de-France…": "Saisissez une adresse en Île-de-France…", "Or a station: metro, RER, bus…": "Ou une station : métro, RER, bus…",
    "Pick on map": "Choisir sur la carte", "Click the map or a station…": "Cliquez sur la carte ou une station…", "Use my location": "Utiliser ma position",
    "Click anywhere, or on a station to snap to it": "Cliquez n'importe où, ou sur une station pour la choisir",
    "Pin placed": "Repère placé", "Dropped pin": "Repère posé", "Locating…": "Recherche de l'adresse…", "(station)": "(station)", "(bus stop)": "(arrêt de bus)",
    "Added.": "Ajouté.", "Could not add: {m}": "Impossible d'ajouter : {m}", "Could not save: {m}": "Impossible d'enregistrer : {m}", "Could not remove: {m}": "Impossible de retirer : {m}",
    "Could not save settings: {m}": "Impossible d'enregistrer les réglages : {m}",
    "Event not found. It may have been deleted.": "Événement introuvable. Il a peut-être été supprimé.", "This event was deleted.": "Cet événement a été supprimé.",
    "Location is not available in this browser.": "La localisation n'est pas disponible dans ce navigateur.", "Your location is outside Île-de-France.": "Votre position est en dehors de l'Île-de-France.",
    "Could not get your location. Type an address instead.": "Impossible d'obtenir votre position. Saisissez plutôt une adresse.",
    "Could not create the event: {m}": "Impossible de créer l'événement : {m}", ". The event server (api/meetup.php) is not reachable.": ". Le serveur d'événements (api/meetup.php) est injoignable.",
    // ---- results ----
    "Add at least two people to see the best meeting point.": "Ajoutez au moins deux personnes pour voir le meilleur lieu de rendez-vous.",
    "No meeting point is reachable for everyone. Check that each person can reach the rail network with a mode they ticked.": "Aucun lieu n'est accessible pour tout le monde. Vérifiez que chaque personne peut rejoindre le réseau ferré avec un mode de transport coché.",
    "Loading the bus network…": "Chargement du réseau de bus…", "Could not compute the meeting point ({m}).": "Impossible de calculer le lieu de rendez-vous ({m}).", " Turn buses off or run tools/build_bus.py.": " Désactivez les bus ou lancez tools/build_bus.py.",
    "Nobody could stay under {n} min. Showing the closest options.": "Personne ne pouvait rester sous {n} min. Voici les options les plus proches.",
    "Longest {max} min · average {avg} min": "Le plus long : {max} min · moyenne : {avg} min", " · near {s}": " · près de {s}",
    "Around {name}: {n} places to eat or drink": "Autour de {name} : {n} lieux où manger ou boire",
    "{n} place to eat or drink": "{n} lieu où manger ou boire", "{n} places to eat or drink": "{n} lieux où manger ou boire",
    "{n} culture or sight": "{n} lieu culturel ou site", "{n} culture and sights": "{n} lieux culturels et sites",
    "{n} park nearby": "{n} parc à proximité", "{n} parks nearby": "{n} parcs à proximité",
    // ---- the vote ----
    "Vote for the meeting place": "Votez pour le lieu de rendez-vous", "The top 5 places": "Les 5 meilleurs lieux",
    "Registration is closed. Pick the option you prefer: {voted} of {n} has voted.": "Les inscriptions sont closes. Choisissez l'option que vous préférez : {voted} sur {n} a voté.",
    "Registration is closed. Pick the option you prefer: {voted} of {n} have voted.": "Les inscriptions sont closes. Choisissez l'option que vous préférez : {voted} sur {n} ont voté.",
    "Voting as": "Vote au nom de", "You are not in this event, so you can only watch the vote.": "Vous ne faites pas partie de cet événement : vous pouvez seulement suivre le vote.",
    "← Reopen registration": "← Rouvrir les inscriptions", "Back to registration. The votes are dropped.": "Retour aux inscriptions. Les votes sont supprimés.",
    "Everybody is in?": "Tout le monde est inscrit ?", "Registration closes and everyone votes for one of the best 5 places. You can reopen it later.": "Les inscriptions se ferment et chacun vote pour l'un des 5 meilleurs lieux. Vous pourrez les rouvrir plus tard.",
    "Everyone is registered: start the vote": "Tout le monde est inscrit : lancer le vote", "The organizer starts the vote once everybody has joined.": "L'organisateur lancera le vote quand tout le monde aura rejoint l'événement.",
    "No meeting point yet.": "Pas encore de lieu.",
    "Close registration and start the vote? Nobody can join or change their position until you reopen it.": "Fermer les inscriptions et lancer le vote ? Personne ne pourra rejoindre l'événement ni changer sa position tant que vous ne les rouvrez pas.",
    "Go back to registration? The votes are dropped.": "Revenir aux inscriptions ? Les votes sont supprimés.",
    "Could not start the vote: {m}": "Impossible de lancer le vote : {m}", "Could not reopen: {m}": "Impossible de rouvrir : {m}", "Could not vote: {m}": "Impossible de voter : {m}",
    "{n} vote": "{n} vote", "{n} votes": "{n} votes", " · leading": " · en tête", "✓ Your vote": "✓ Votre vote", "Vote": "Voter",
    // ---- notices about the page itself ----
    "The server says {n} remembered event no longer exists ({ids}), so it was removed from the list.": "Le serveur indique qu'un événement mémorisé n'existe plus ({ids}) : il a été retiré de la liste.",
    "The server says {n} remembered events no longer exist ({ids}), so they were removed from the list.": "Le serveur indique que {n} événements mémorisés n'existent plus ({ids}) : ils ont été retirés de la liste.",
    "Could not check {n} event with the server ({why}).": "Impossible de vérifier {n} événement auprès du serveur ({why}).", "Could not check {n} events with the server ({why}).": "Impossible de vérifier {n} événements auprès du serveur ({why}).",
    "Event {id}": "Événement {id}",
    "Remembered {n} event in this browser ({left} in the list).": "{n} événement mémorisé dans ce navigateur ({left} dans la liste).", "Remembered {n} events in this browser ({left} in the list).": "{n} événements mémorisés dans ce navigateur ({left} dans la liste).",
    "This browser blocks site storage, so it cannot remember events. Allow cookies and site data for this address.": "Ce navigateur bloque le stockage du site : il ne peut pas mémoriser les événements. Autorisez les cookies et données de site pour cette adresse.",
    "This browser blocks site storage, so it cannot remember your events or your organizer key. Allow cookies and site data for this address.": "Ce navigateur bloque le stockage du site : il ne peut mémoriser ni vos événements ni votre clé d'organisateur. Autorisez les cookies et données de site pour cette adresse.",
    "Re-downloading everything…": "Retéléchargement de tout…",
    "A new version is installed, but this browser still shows the old one. Use \"Reload everything\" below.": "Une nouvelle version est installée, mais ce navigateur affiche encore l'ancienne. Utilisez « Tout recharger » ci-dessous.",
    "A new version is available. Finish what you are doing, then ": "Une nouvelle version est disponible. Terminez ce que vous faites, puis ", "reload": "rechargez",
    "Could not load data/graph.json. Run tools/build_graph.py first.": "Impossible de charger data/graph.json. Lancez d'abord tools/build_graph.py.",
    "Can't reach the event server ({why}). Serve this folder with PHP (see README). If it is running, a content blocker may be blocking api/meetup.php.": "Impossible de joindre le serveur d'événements ({why}). Servez ce dossier avec PHP (voir le README). S'il tourne, un bloqueur de contenu bloque peut-être api/meetup.php.",
    // ---- messages from the server ----
    "event not found": "événement introuvable", "this event is full": "cet événement est complet", "registration is closed": "les inscriptions sont closes", "registration is already closed": "les inscriptions sont déjà closes",
    "organizer only": "réservé à l'organisateur", "not your entry": "ce n'est pas votre entrée", "person not found": "personne introuvable", "bad position": "position invalide", "position outside Île-de-France": "position hors Île-de-France",
    "at least two people are needed": "il faut au moins deux personnes", "voting is not open": "le vote n'est pas ouvert", "bad choice": "choix invalide", "bad ballot": "liste de choix invalide", "too many events on this server": "trop d'événements sur ce serveur",
    "too large": "requête trop volumineuse", "bad json": "requête invalide", "unknown action": "action inconnue", "corrupt event": "événement corrompu", "method": "méthode non autorisée",
  };

  const saved = (() => { try { return localStorage.getItem("meetpoint:lang"); } catch (e) { return null; } })();
  const LANG = saved === "fr" || saved === "en" ? saved : (/^fr/i.test(navigator.language || "") ? "fr" : "en");
  const missing = new Set();

  function fill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s; }
  function t(en, vars) {
    let s = en;
    if (LANG === "fr") { if (Object.prototype.hasOwnProperty.call(FR, en)) s = FR[en]; else if (/[A-Za-z]{3}/.test(en)) missing.add(en); }
    return fill(s, vars);
  }
  const tn = (n, one, other, vars) => t((LANG === "fr" ? n < 2 : n === 1) ? one : other, Object.assign({ n }, vars));
  function setLang(l) { try { localStorage.setItem("meetpoint:lang", l); } catch (e) { /* the choice just will not be remembered */ } location.reload(); }

  /* the fixed text of index.php: data-i18n (text), data-i18n-title, data-i18n-placeholder, data-i18n-aria */
  function applyStatic() {
    document.documentElement.lang = LANG;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    document.querySelectorAll("#lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === LANG));
  }
  root.I18n = { LANG, t, tn, setLang, applyStatic, missing, FR };
})(window);
