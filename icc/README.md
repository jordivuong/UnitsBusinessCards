# Profils ICC

Les profils ne sont **pas** versionnés (licence ECI). Placez ici, avant de démarrer en production :

- `ISOcoated_v2_300_eci.icc` : offset (profil par défaut du modèle `classique-v1`) ;
- `FOGRA39L_coated.icc` : numérique express.

Téléchargement : <https://www.eci.org/> (« ECI Offset 2009 » / « Fogra39 »). Vérifiez les conditions de licence.
Sans profil, le serveur refuse de démarrer. `ALLOW_TEST_PROFILE=1` utilise un profil CMJN générique
**pour les essais uniquement** (les PDF produits ne doivent pas être imprimés).
