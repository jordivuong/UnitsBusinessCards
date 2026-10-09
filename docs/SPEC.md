# Spécification : générateur de cartes de visite PDF/X-3 (CMJN, offset)

Date : 2026-10-09. Cible d'impression : h2impression (Paris), cartes de visite offset.

## 1. Objectif

Webapp permettant à des clients sans logiciel de création de modifier seuls les textes (et un logo optionnel) d'un template verrouillé, puis de télécharger un PDF directement acceptable par l'imprimeur. Le design est figé : le client ne peut ni déplacer ni casser la mise en page.

## 2. Exigences de l'imprimeur (source : pages h2impression, voir fin de document)

- Format de fichier : PDF enregistré en PDF/X-3 (systématique). PDF et JPEG qualité maximale uniquement ; Word, PowerPoint, Publisher refusés.
- Fonds perdus : 3 mm minimum tout autour. Cette zone contient fonds et images, jamais de texte ni de logo.
- Zone de sécurité interne : 3 mm sans texte ni logo.
- Traits de coupe : à laisser s'ils sont générés automatiquement par un logiciel vectoriel ; ils doivent couper exactement au format fini.
- Polices : vectorisées (converties en tracés), sinon la commande est mise en pause.
- Images : 300 dpi, 8 bits.
- Couleurs : CMJN. La conversion RVB vers CMJN ternit les couleurs vives, donc les couleurs sont définies en CMJN dès la conception.
- Profils selon le produit : numérique express = Fogra 39 ; offset express ou sur mesure = ISO Coated V2 ; offset discount = ISO 12647-2.
- Tons directs (Pantone) : réservés aux grosses séries en offset, hors périmètre v1.

A confirmer avec les graphistes h2 (01 84 80 23 70) avant de figer :
- format fini exact et grammage du produit visé (85 x 55 mm supposé ci-dessous) ;
- préférence entre un PDF avec traits de coupe et un PDF 91 x 61 mm sans marques (les deux variantes sont prévues) ;
- profil à utiliser pour le produit retenu (ISO Coated V2 par défaut pour l'offset).

## 3. Architecture

Un navigateur travaille en RVB et ne produit ni PDF/X-3 ni profil ICC. Le PDF final passe donc par Ghostscript côté serveur.

Hébergement : conteneur Docker (Fly.io, Railway, Render, VPS). Un hébergement serverless de type Vercel ne fournit pas le binaire gs.

Flux :
1. Front : formulaire et aperçu aux dimensions réelles, puis POST /api/render avec templateId, fields, logo optionnel.
2. Serveur, étape A : validation, puis génération d'un PDF vectoriel en CMJN pur.
3. Serveur, étape B : Ghostscript produit le PDF/X-3 (OutputIntent, polices vectorisées, boxes).
4. Serveur, étape C : contrôles automatiques, puis réponse avec le PDF et un PNG d'aperçu rastérisé depuis le PDF final.

Stack suggérée :
- Node 22 avec Fastify ou Express.
- PDFKit (couleurs passées en [C, M, Y, K] de 0 à 100) ou pdf-lib (fonction cmyk()), plus fontkit pour les polices.
- Image Docker : ghostscript 10 ou plus, imagemagick (lcms2), poppler-utils (pdfinfo, pdffonts, pdfimages) pour les contrôles.

## 4. Templates (fichiers JSON dans templates/)

Chaque template décrit : id, nom, format fini (mm), fonds perdus (mm), palette CMJN nommée, pages (recto, verso optionnel) et éléments. Types d'éléments :
- rect et line : couleur de la palette, jamais de RVB ;
- text : champ éditable ou texte fixe, avec police, corps, interlettrage, alignement, couleur CMJN, largeur max, corps min (réduction automatique jusqu'au min, puis erreur), nombre de caractères max ;
- image : emplacement de logo avec cadre, ajustement (contain) et fond de référence pour l'aplatissement.

Le client ne peut modifier que la valeur des champs text et le fichier du slot image.

Exemple minimal :

```json
{
  "id": "classique-v1",
  "trim": { "w": 85, "h": 55 },
  "bleed": 3,
  "palette": {
    "encre": [0, 0, 0, 100],
    "accent": [85, 20, 0, 0],
    "fond": [0, 0, 0, 0]
  },
  "pages": [
    {
      "name": "recto",
      "elements": [
        { "type": "rect", "x": -3, "y": -3, "w": 91, "h": 61, "fill": "fond" },
        { "type": "text", "field": "nom", "font": "Inter-SemiBold", "size": 11, "minSize": 8,
          "x": 8, "y": 10, "maxW": 69, "fill": "encre", "label": "Nom", "maxChars": 40 },
        { "type": "text", "field": "titre", "font": "Inter-Regular", "size": 8, "minSize": 6.5,
          "x": 8, "y": 16, "maxW": 69, "fill": "accent", "label": "Fonction", "maxChars": 50 }
      ]
    }
  ]
}
```

## 5. Etape A : génération du PDF CMJN

Boxes (valeurs pour 85 x 55 mm, fonds perdus 3 mm) :
- Variante avec marques : MediaBox = fini + 9 mm par côté (103 x 73 mm), TrimBox = 85 x 55 mm centré, BleedBox = fini + 3 mm par côté (91 x 61 mm).
- Variante sans marques : MediaBox = BleedBox = 91 x 61 mm, TrimBox = 85 x 55 mm.
- Traits de coupe : décalés de 3,5 mm du fini (hors zone de fonds perdus), longueur 5 mm, épaisseur 0,25 pt, couleur C100 M100 Y100 K100 (marques uniquement).
- Conversions utiles : 1 mm = 2,83465 pt ; 3 mm = 8,504 pt ; 9 mm = 25,512 pt ; 85 mm = 240,945 pt ; 55 mm = 155,906 pt.

Couleurs :
- Tout en DeviceCMYK. Ni RVB, ni ICCBased, ni couleur d'accompagnement.
- Texte courant en K100 seul (C0 M0 Y0 K100), pas de noir quadri sur du texte fin (repérage).
- Grands aplats noirs : noir riche, par exemple C60 M40 Y40 K100.
- Couverture d'encre totale (TAC) limitée à 300 % pour ISO Coated V2, sauf les traits de coupe.

Texte :
- Polices TTF ou OTF intégrées (licence d'incorporation à vérifier), vectorisées à l'étape B.
- Corps minimum 6 pt ; texte en réserve (clair sur fond foncé) au moins 7 pt, sans empattements fins.
- Chaque boîte de texte calculée doit rester dans la zone de sécurité (3 mm à l'intérieur du fini). Sinon : réduction jusqu'au corps min, puis erreur lisible.
- Détection des glyphes absents de la police (message en français).

Images (logo) :
- v1 : PNG ou JPEG. Résolution effective au format placé : avertissement sous 300 ppi, refus sous 150 ppi.
- Conversion sRGB (ou profil embarqué) vers CMJN via lcms2 avec le profil de sortie, intention colorimétrique relative avec compensation du point noir, puis intégration en DeviceCMYK.
- Le PDF/X-3 n'admet pas la transparence : un PNG avec canal alpha est aplati sur la couleur de fond connue de l'emplacement ; si le fond n'est pas uni, exiger un logo opaque.
- SVG ou PDF vectoriel pour le logo : v2 (conversion couleur par couleur).

Interdits dans les templates : transparence, opacité inférieure à 100 %, ombres portées, modes de fusion, filets de moins de 0,25 pt.

## 6. Etape B : Ghostscript vers PDF/X-3

Commande indicative, à valider sur la version de gs installée (consulter la doc Ghostscript sur PDFX et le modèle PDFX_def.ps livré avec gs) :

```
gs -dBATCH -dNOPAUSE -dQUIET -dSAFER \
   -sDEVICE=pdfwrite -dCompatibilityLevel=1.3 \
   -dPDFX=3 \
   -sProcessColorModel=DeviceCMYK \
   -sColorConversionStrategy=LeaveColorUnchanged \
   -dNoOutputFonts \
   -dPDFXSetBleedBoxToMediaBox=false \
   -sOutputFile=out.pdf PDFX_def.ps in.pdf
```

Points d'attention :
- Les couleurs sont déjà en CMJN : l'objectif est de ne pas les retoucher. Une conversion ICC de DeviceCMYK vers CMJN peut transformer un K100 en noir riche. Si gs impose une autre stratégie, tester et vérifier que le texte reste C0 M0 Y0 K100 (voir contrôles).
- PDFX_def.ps : OutputIntent avec le profil ICC (fichier à placer dans icc/), /GTS_PDFXVersion (PDF/X-3:2002), /OutputConditionIdentifier (FOGRA39 pour ISO Coated V2 et Fogra 39, à vérifier sur le registre ICC), /RegistryName (http://www.color.org), /Trapped /False, titre.
- Boxes : définir TrimBox et BleedBox via les paramètres pdfwrite (PDFXTrimBoxToMediaBoxOffset, PDFXBleedBoxToTrimBoxOffset, à passer par setpagedevice ou PDFX_def.ps), puis vérifier avec pdfinfo -box. Ne pas supposer que les boxes du PDF source sont conservées.
- Profil ICC par produit, configurable : ISOcoated_v2_300_eci.icc (téléchargement sur eci.org, vérifier les conditions de licence) par défaut ; FOGRA39L_coated.icc pour le numérique express ; ISO 12647-2 pour l'offset discount. Ne pas commiter de profil sans avoir vérifié sa licence.
- Gestion des erreurs : timeout 20 s, code retour non nul = erreur 500 sans fuite de chemin.

## 7. Etape C : contrôles automatiques (échec = erreur 422 avec message français)

- pdfinfo -box : MediaBox, TrimBox, BleedBox conformes à l'étape A, pages = 1 ou 2.
- pdffonts : aucune police listée (tout vectorisé) ; sinon toutes intégrées.
- pdfimages -list : espace cmyk uniquement, résolution effective au moins 300 ppi.
- gs -o - -sDEVICE=inkcov in.pdf : aucun noir texte avec C, M ou Y non nuls ; TAC maximal 300 % hors marques ; aucun canal RVB.
- Présence dans le fichier : /GTS_PDFXVersion, /OutputIntents avec sous-type /GTS_PDFX, absence de /SMask et de groupe de transparence, version PDF 1.3 ou 1.4.
- Preflight de référence, hors CI : Ghent PDF Output Suite ou callas pdfToolbox sur un échantillon.

## 8. Front (client)

- Interface en français, utilisable sur mobile.
- Champs texte avec compteur de caractères et messages de validation en direct.
- Aperçu à l'échelle avec calques activables : fonds perdus, zone de sécurité, coupe.
- Bascule recto / verso si le template en a un.
- Avant téléchargement : aperçu PNG rastérisé depuis le PDF final (ce que le client valide est ce qui sera imprimé).
- Mention visible : les couleurs écran diffèrent du papier ; un BAT (test d'impression) est disponible chez h2impression.
- Bouton unique : télécharger le PDF imprimeur (case pour inclure ou non les traits de coupe).

## 9. Sécurité et exploitation

- gs lancé par spawn avec arguments fixes, jamais via un shell. Aucun texte utilisateur dans du PostScript.
- Dossier temporaire unique par requête, supprimé en fin de traitement.
- Uploads : PNG et JPEG uniquement, 10 Mo maximum, contrôle des signatures de fichier, limite de dimensions, limitation de débit.
- Aucune conservation des PDF ; les valeurs des champs des cartes générées sont conservées par client (`/data/cards`) pour être modifiées ; logs sans données personnelles.
- Licences : Ghostscript est sous AGPL (utilisation en sous-processus non modifié) ; profils ICC ECI et polices : vérifier les conditions.

## 10. Structure du dépôt suggérée

```
/server        API, génération PDF (etape A), appel gs (etape B), contrôles (etape C)
/web           formulaire et aperçu
/templates     templates JSON
/fonts         polices autorisées
/icc           profils ICC (voir licences)
/gs            PDFX_def.ps (modèle)
/tests         PDF de référence et tests automatiques
Dockerfile     node 22 + ghostscript + imagemagick + poppler-utils
```

## 11. Critères d'acceptation

1. Un template, 2 champs modifiés : un PDF valide est produit en moins de 5 s.
2. Les contrôles de l'étape C passent sur tous les PDF de test (avec et sans marques, avec et sans logo).
3. Un texte K100 reste C0 M0 Y0 K100 après Ghostscript.
4. Un texte trop long est réduit jusqu'au corps minimum puis refusé avec un message clair ; aucun texte ne sort de la zone de sécurité.
5. Un logo trop petit en résolution est signalé ou refusé selon les seuils.
6. Test réel : commande d'un BAT chez h2impression avec un PDF généré, puis validation par leurs graphistes (fichier accepté sans reprise).

## 12. Hors périmètre v1 / évolutions

Pantone et tons directs, vernis sélectif, dorure, formes découpées, QR code vCard vectoriel, logo SVG ou PDF vectoriel avec conversion couleur, éditeur visuel de templates, comptes clients.

## Sources

- https://www.h2impression.fr/fr/l/mon-fichier
- https://www.h2impression.fr/fr/l/rvb-cmjn
- https://www.h2impression.fr/fr/l/logiciels-en-ligne
