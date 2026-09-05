import type { Locale } from './config'

type Dict = Record<string, string>

const en: Dict = {
  'app.name': 'Nelth-IA',
  'common.signIn': 'Sign In',
  'common.signUp': 'Sign Up',
  'common.signInWithGoogle': 'Sign In with Google',
  'common.continueWith': 'Continue with Nelth-IA',
  'common.toUse':
    'To use Nelth-IA, sign in to your account or create a new one.',
  'common.newChat': 'New Chat',
  'common.send': 'Send',
  'common.stop': 'Stop',
  'common.searchHistory': 'Search history',
  'common.backToHome': 'Back to Home',
  'common.library': 'Library',
  'common.settings': 'Settings',
  'common.logout': 'Log out',
  'common.or': 'Or',
  'common.tips': 'Tips:',

  'auth.welcomeBack': 'Welcome back',
  'auth.signInToAccount': 'Sign in to your account',
  'auth.createAccount': 'Create an account',
  'auth.enterDetails': 'Enter your details below to get started',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.repeatPassword': 'Repeat Password',
  'auth.forgotPassword': 'Forgot password?',
  'auth.dontHaveAccount': "Don't have an account?",
  'auth.alreadyHaveAccount': 'Already have an account?',
  'auth.firstName': 'First name',
  'auth.lastName': 'Last name',
  'auth.passwordsDoNotMatch': 'Passwords do not match',
  'auth.loggingIn': 'Logging in...',
  'auth.creatingAccount': 'Creating account...',

  'chat.hello': 'Hello',
  'chat.placeholder': 'Ask anything...',
  'chat.reply': 'Reply...',
  'chat.greetingTip': 'Ask me anything to get started.',

  'connector.title': 'Connect your apps to Nelth-AI',
  'connector.description':
    'Connecting apps like your calendar and email lets you get more done directly with Nelth-AI.',
  'connector.connect': 'Connect',
  'connector.connecting': 'Connecting…',
  'connector.connected': 'Connected',
  'connector.retry': 'Retry',
  'connector.disconnect': 'Disconnect',
  'connector.notConfigured': 'Not configured',
  'connector.signInRequired': 'Sign in to connect apps',
  'connector.revokeNote':
    'Also revoke access in the provider settings to fully disconnect.',
  'connector.manage': 'Manage',
  'connector.dismiss': 'Dismiss connector suggestions',
  'connector.panelTitle': 'Connect an app',
  'connector.panelSubtitle':
    'Give Nelth-IA access so it can work with your files, mail and calendar.',
  'connector.close': 'Close',

  'feedback.title': 'Feedback',
  'feedback.help':
    'Your feedback helps us improve Nelth-IA. Let us know what you think!',
  'feedback.placeholder': 'Share your feedback...',
  'feedback.send': 'Send feedback',
  'feedback.thanks': 'Thank you for your feedback!',
  'feedback.failed':
    'Failed to submit feedback. Please try again later.',
  'feedback.selectRequired':
    'Please select your sentiment and write a message',

  'error.rateLimit': 'Rate Limit Exceeded',
  'error.accessDenied': 'Access Denied',
  'error.errorOccurred': 'Error Occurred',
  'error.tooManyRequests':
    'You have made too many requests. Please wait a moment before trying again.',
  'error.authRequired':
    'To use Nelth-IA, sign in to your account or create a new one.',
  'error.forbidden': 'You do not have permission to access this resource.',
  'error.unexpected': 'An unexpected error occurred. Please try again.',
  'error.limitResets': 'The limit resets at midnight UTC.',
  'common.tryAgain': 'Try Again',
  'common.understood': 'Understood',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.submit': 'Submit',
  'common.submitting': 'Submitting...',

  'footer.tip':
    'Nelth-IA can make mistakes. Please double-check responses.'
}

const fr: Dict = {
  'app.name': 'Nelth-IA',
  'common.signIn': 'Se connecter',
  'common.signUp': "S'inscrire",
  'common.signInWithGoogle': 'Se connecter avec Google',
  'common.continueWith': 'Continuer avec Nelth-IA',
  'common.toUse':
    'Pour utiliser Nelth-IA, connectez-vous à votre compte ou créez-en un nouveau.',
  'common.newChat': 'Nouvelle conversation',
  'common.send': 'Envoyer',
  'common.stop': 'Arrêter',
  'common.searchHistory': 'Historique',
  'common.backToHome': 'Retour à l’accueil',
  'common.library': 'Bibliothèque',
  'common.settings': 'Paramètres',
  'common.logout': 'Se déconnecter',
  'common.or': 'Ou',
  'common.tips': 'Astuces :',

  'auth.welcomeBack': 'Bon retour',
  'auth.signInToAccount': 'Connectez-vous à votre compte',
  'auth.createAccount': 'Créer un compte',
  'auth.enterDetails': 'Saisissez vos informations pour commencer',
  'auth.email': 'Adresse e-mail',
  'auth.password': 'Mot de passe',
  'auth.repeatPassword': 'Confirmer le mot de passe',
  'auth.forgotPassword': 'Mot de passe oublié ?',
  'auth.dontHaveAccount': "Vous n'avez pas de compte ?",
  'auth.alreadyHaveAccount': 'Vous avez déjà un compte ?',
  'auth.firstName': 'Prénom',
  'auth.lastName': 'Nom',
  'auth.passwordsDoNotMatch': 'Les mots de passe ne correspondent pas',
  'auth.loggingIn': 'Connexion...',
  'auth.creatingAccount': 'Création du compte...',

  'chat.hello': 'Bonjour',
  'chat.placeholder': 'Posez n’importe quelle question...',
  'chat.reply': 'Répondre...',
  'chat.greetingTip': 'Posez-moi une question pour commencer.',

  'connector.title': 'Connectez vos applications à Nelth-IA',
  'connector.description':
    'La connexion d’applications comme Google Drive, Gmail, GitHub ou Notion vous permet d’accomplir plus de tâches directement avec Nelth-IA.',
  'connector.connect': 'Connecter',
  'connector.connecting': 'Connexion…',
  'connector.connected': 'Connecté',
  'connector.retry': 'Réessayer',
  'connector.disconnect': 'Déconnecter',
  'connector.notConfigured': 'Non configuré',
  'connector.signInRequired':
    'Connectez-vous pour connecter des applications',
  'connector.revokeNote':
    'Révoquez aussi l’accès dans les paramètres du fournisseur pour une déconnexion complète.',
  'connector.manage': 'Gérer',
  'connector.dismiss': 'Masquer les suggestions de connexion',
  'connector.panelTitle': 'Connecter une application',
  'connector.panelSubtitle':
    'Donnez à Nelth-IA l’accès à vos fichiers, e-mails et calendriers pour travailler directement avec.',
  'connector.close': 'Fermer',

  'feedback.title': 'Commentaires',
  'feedback.help':
    'Vos commentaires nous aident à améliorer Nelth-IA. Dites-nous ce que vous en pensez !',
  'feedback.placeholder': 'Partagez vos commentaires...',
  'feedback.send': 'Envoyer un commentaire',
  'feedback.thanks': 'Merci pour vos commentaires !',
  'feedback.failed':
    'Échec de l’envoi du commentaire. Veuillez réessayer plus tard.',
  'feedback.selectRequired':
    'Veuillez choisir un sentiment et écrire un message',

  'error.rateLimit': 'Limite de requêtes atteinte',
  'error.accessDenied': 'Accès refusé',
  'error.errorOccurred': 'Une erreur est survenue',
  'error.tooManyRequests':
    'Vous avez envoyé trop de requêtes. Veuillez patienter un instant.',
  'error.authRequired':
    'Pour utiliser Nelth-IA, connectez-vous à votre compte ou créez-en un nouveau.',
  'error.forbidden': 'Vous n’êtes pas autorisé à accéder à cette ressource.',
  'error.unexpected': 'Une erreur inattendue est survenue. Veuillez réessayer.',
  'error.limitResets': 'La limite se réinitialise à minuit UTC.',
  'common.tryAgain': 'Réessayer',
  'common.understood': 'Compris',
  'common.close': 'Fermer',
  'common.cancel': 'Annuler',
  'common.submit': 'Envoyer',
  'common.submitting': 'Envoi...',

  'footer.tip':
    'Nelth-IA peut faire des erreurs. Vérifiez bien les réponses.'
}

export const translations: Record<Locale, Dict> = { en, fr }

/** Random question phrases shown in the empty chat greeting, per locale. */
export const greetingPhrases: Record<Locale, string[]> = {
  en: [
    'What would you like to know?',
    'What can I help you with today?',
    'What do you want to explore?',
    'How can I assist you?',
    'Where would you like to start?'
  ],
  fr: [
    'Que puis-je faire pour vous aujourd’hui ?',
    'Sur quoi souhaitez-vous travailler ?',
    'Comment puis-je vous aider ?',
    'Que voulez-vous découvrir ensemble ?',
    'Par où aimeriez-vous commencer ?'
  ]
}
