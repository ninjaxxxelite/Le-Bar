# Le Bar — Brancher une base de données externe (Supabase)

Objectif : garder votre interface HTML sur GitHub Pages, mais stocker les
**comptes**, les **bouteilles** et les **photos** dans une base externe, avec
des **rôles admin/user réellement sécurisés** (côté serveur) et une
**synchronisation** entre tous les appareils.

## Pourquoi Supabase
Votre site est *statique* (GitHub Pages ne peut pas exécuter de code serveur).
Supabase fournit, appelable directement depuis le navigateur : authentification,
base Postgres, et stockage de fichiers. La sécurité est assurée par les règles
**RLS** de la base — pas par le HTML. C'est ce qui rend les rôles inviolables.
(Alternative équivalente : Firebase. Ici on part sur Supabase.)

---

## Étapes (environ 15 min)

### 1. Créer le projet
- Compte gratuit sur https://supabase.com → **New project**.
- Notez le mot de passe de la base (non utilisé côté front, mais utile).

### 2. Créer les tables, rôles, sécurité et stockage
- Menu **SQL Editor** → **New query** → collez tout `supabase_setup.sql` → **Run**.
- Cela crée les tables `profiles` et `bottles`, les règles RLS, les déclencheurs
  (création auto du profil à l'inscription, protection des rôles) et le bucket
  de stockage `photos`.

### 3. Activer l'authentification e-mail
- Menu **Authentication > Providers** : **Email** est activé par défaut.
- Pour tester vite, vous pouvez désactiver la confirmation par e-mail
  (**Authentication > Sign In / Providers > Email > Confirm email = off**).

### 4. Récupérer vos clés
- Menu **Project Settings > API** :
  - **Project URL** → `SUPABASE_URL`
  - clé **anon / publishable** (publique) → `SUPABASE_ANON_KEY`
- Copiez `config.example.js` en **`config.js`** et renseignez ces deux valeurs.
  > La clé anon est publique par conception : la publier sur GitHub ne pose pas
  > de problème. Ne mettez JAMAIS la clé **service_role** dans le front-end.

### 5. Devenir administrateur
- Ouvrez l'app une fois branchée (étape 6), **inscrivez-vous** avec votre e-mail.
- Puis dans **SQL Editor**, lancez (avec votre e-mail) :
  ```sql
  update public.profiles set role = 'admin' where email = 'VOTRE_EMAIL';
  ```
- Les comptes créés ensuite seront **user** par défaut.

### 6. Brancher le front-end
Dans `index.html`, **avant** `app.js`, ajoutez :
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="db.js"></script>
```
Déposez `config.js` et `db.js` dans le même dossier que `index.html`,
puis poussez sur GitHub. (`db.js` expose `window.DB`.)

---

## Ce que fournit `db.js` (window.DB)
- **Auth** : `signUp`, `signIn`, `signOut`, `onAuthChange`, `currentUser` (avec le rôle).
- **Cave** : `listBottles`, `saveBottle`, `deleteBottle` (objets au même format qu'aujourd'hui).
- **Photos** : `uploadPhoto(file)` → `{ url, path }`, `deletePhoto(path)`.
- **Admin** : `listProfiles`, `setRole`, `renameProfile` (n'aboutit que pour un admin, garanti par RLS).

## Ce qu'il reste à faire dans l'app (étape suivante)
Le code actuel lit/écrit dans le navigateur (localStorage). Il faut :
1. Ajouter un **écran de connexion** (email + mot de passe) qui masque l'app tant
   qu'on n'est pas connecté (`DB.currentUser()`), et un bouton **Déconnexion**.
2. Remplacer les accès locaux par la base :
   - au chargement : `bottles = await DB.listBottles()`
   - à l'enregistrement : `await DB.saveBottle(b)`
   - à la suppression : `await DB.deleteBottle(id)`
3. Photos : au lieu du base64, `const {url} = await DB.uploadPhoto(fichier)` puis
   stocker `url` dans la bouteille.
4. Le panneau **Administration** utilise `DB.listProfiles` / `DB.setRole` : les
   rôles deviennent réels (l'onglet n'apparaît que pour un admin, et le serveur
   refuse toute action non autorisée).

> Je peux livrer cette version « branchée » de `index.html` + `app.js` :
> il suffit de me confirmer que vous partez sur Supabase avec connexion
> e-mail + mot de passe.

## Bonus (plus tard)
- Déplacer l'appel IA (lecture d'étiquette) dans une **Edge Function** Supabase
  pour cacher la clé Anthropic côté serveur.
- Migrer vos données locales existantes via l'export JSON → import en base.
