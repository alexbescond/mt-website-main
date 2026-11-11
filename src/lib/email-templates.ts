import { translator, localizedPath, type Locale } from "./i18n";
import { SEND_INTERVAL_DAYS, SITE_NAME, type DeliveryMode } from "./catalog";
import { displayDate, TRACKING_LINK_DAYS } from "./tracking-model";

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

interface EmailCopy {
  subject: string;
  preview: string;
  eyebrow: string;
  title: string;
  accent: string;
  paragraphs: string[];
  detailTitle: string;
  detail: string;
  action: string;
  closing: string;
}

// Parents read these emails: keep the tone warm but plain, without diminutives or travel metaphors.
function notificationCopy(kind: string, reference: string, position?: number, date?: string, deliveryMode: DeliveryMode = "weekly", locale: Locale = "fr"): EmailCopy {
  const t = translator(locale);
  if (kind === "shipped") {
    const sentOn = displayDate(date!, locale);
    if (deliveryMode === "together") return {
      subject: t("Vos cartes ont été expédiées — commande {0}", reference),
      preview: t("Toutes vos cartes ont été expédiées ensemble le {0}.", sentOn),
      eyebrow: t("CARTES EXPÉDIÉES"),
      title: t("Toutes vos cartes"),
      accent: t("sont en route."),
      paragraphs: [t("Nous avons expédié toutes vos cartes dans un seul envoi le {0}, à l’adresse indiquée lors de votre commande. Le délai de réception dépend de l’acheminement postal.", sentOn)],
      detailTitle: t("Votre envoi groupé"),
      detail: t("Vous pourrez découvrir les cartes ensemble ou les offrir une à une, au rythme de votre enfant."),
      action: t("Suivre mes cartes"),
      closing: t("Nous espérons qu’elles feront plaisir à votre enfant."),
    };
    return {
      subject: t("Carte {0} expédiée — commande {1}", position ?? 1, reference),
      preview: t("Expédiée le {0}, à l’adresse indiquée lors de votre commande.", sentOn),
      eyebrow: t("CARTE EXPÉDIÉE"),
      title: t("La carte {0}", position ?? 1),
      accent: t("est en route."),
      paragraphs: [
        t("Nous avons expédié la carte {0} le {1}, à l’adresse indiquée lors de votre commande. Le délai de réception dépend désormais de l’acheminement postal.", position ?? 1, sentOn),
      ],
      detailTitle: t("Où en est votre commande ?"),
      detail: t("Votre page de suivi récapitule les cartes déjà expédiées et, s’il en reste à envoyer, la date prévue du prochain envoi."),
      action: t("Suivre mes cartes"),
      closing: t("Nous espérons qu’elle fera plaisir à votre enfant."),
    };
  }

  if (kind === "access") {
    return {
      subject: t("Votre lien de suivi — commande {0}", reference),
      preview: t("Voici le lien demandé pour suivre votre commande. Il est valable {0} jours.", TRACKING_LINK_DAYS),
      eyebrow: t("ACCÈS AU SUIVI"),
      title: t("Votre lien de suivi"),
      accent: t("est prêt."),
      paragraphs: [
        t("Vous avez demandé à accéder au suivi de votre commande. Utilisez le lien ci-dessous : aucun compte n’est nécessaire."),
      ],
      detailTitle: t("Ce que vous y trouverez"),
      detail: t("L’état de préparation de chaque carte, les dates d’expédition et, s’il reste des cartes à envoyer, la date prévue du prochain envoi."),
      action: t("Accéder au suivi"),
      closing: t("Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail : votre commande n’est pas modifiée."),
    };
  }

  return {
    subject: t("Votre commande {0} est confirmée", reference),
    preview: t("Commande confirmée : nous préparons les cartes et vous préviendrons à chaque expédition."),
    eyebrow: t("COMMANDE CONFIRMÉE"),
    title: t("Merci pour votre commande."),
    accent: t("Nous nous occupons du reste."),
    paragraphs: [
      t("Votre commande est confirmée et enregistrée."),
      t("Nous allons maintenant créer les cartes de votre enfant à partir de la photo que vous nous avez confiée et des aventures choisies. Chacune comportera une illustration et un message à son prénom."),
    ],
    detailTitle: t("Les prochaines étapes"),
    detail: deliveryMode === "together" ? t("Nous préparons toutes vos cartes pour les expédier ensemble, dans un seul envoi. Vous recevrez un e-mail au moment de l’expédition ; le délai de réception dépend ensuite de l’acheminement postal.") : t("Nous commençons par préparer la première carte. Si vous en avez commandé plusieurs, les suivantes seront expédiées à {0} jours d’intervalle. Vous recevrez un e-mail à chaque expédition ; le délai de réception dépend ensuite de l’acheminement postal.", SEND_INTERVAL_DAYS),
    action: t("Suivre mes cartes"),
    closing: t("Nous espérons que ces cartes deviendront de beaux souvenirs de famille."),
  };
}

// Use the site's paper, sage and terracotta palette, with email-safe system fonts.
// All essential content stays readable without images, external styles or web fonts.
export function notificationMessage(kind: string, reference: string, link: string, position?: number, date?: string, deliveryMode: DeliveryMode = "weekly", locale: Locale = "fr") {
  const t = translator(locale);
  const copy = notificationCopy(kind, reference, position, date, deliveryMode, locale);
  const origin = new URL(link).origin;
  const renewalLink = origin + localizedPath("/suivi", locale);
  const questionsLink = origin + localizedPath("/#questions", locale);
  const privacy = t("Ce lien est personnel et valable {0} jours. Gardez-le pour vous : il donne accès au suivi de votre commande.", TRACKING_LINK_DAYS);
  const renewal = t("Votre lien a expiré ? Demandez-en un nouveau depuis la page de suivi, avec votre adresse e-mail et votre référence de commande.");
  const signoff = t("À bientôt,");
  const tagline = t("Des cartes à recevoir, à relire et à garder.");
  const paragraphStyle = "margin:0 0 18px;color:#354d42;font-size:16px;line-height:1.75";

  return {
    subject: copy.subject,
    text: [
      t(SITE_NAME),
      copy.title + " " + copy.accent,
      t("Commande ") + reference,
      t("Bonjour,"),
      ...copy.paragraphs,
      copy.detailTitle + "\n" + copy.detail,
      copy.action + " : " + link,
      copy.closing,
      signoff + "\n" + t("L’équipe « {0} »", t(SITE_NAME)),
      privacy,
      renewal + "\n" + renewalLink,
      t("Une question ? Consultez nos réponses : ") + questionsLink,
      tagline,
    ].join("\n\n"),
    html: `<!doctype html>
<html lang="${locale}" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(copy.subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { padding: 20px 12px !important; }
        .email-content { padding: 28px 24px !important; }
        .email-title { font-size: 32px !important; }
        .email-button { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:#faf7f0;color:#354d42;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div lang="${locale}" dir="ltr" aria-hidden="true" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(copy.preview)}</div>
    <table lang="${locale}" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#faf7f0;">
      <tr>
        <td class="email-shell" align="center" style="padding:36px 16px;">
          <!--[if mso]><table role="presentation" width="580" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:580px;">
            <tr>
              <td align="center" style="padding:0 12px 28px;">
                <a href="${escapeHtml(origin + localizedPath("/", locale))}" style="color:#354d42;text-decoration:none;">
                  <span style="font-size:12px;line-height:1.8;letter-spacing:1px;">${escapeHtml(t("Les aventures de"))}</span><br>
                  <span style="font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.4;">${escapeHtml(t("mon doudou"))} <i style="color:#b7533a;">${escapeHtml(t("et"))}</i> ${escapeHtml(t("ma tétine"))}</span>
                </a>
              </td>
            </tr>
            <tr>
              <td style="background-color:#fffdf8;border:1px solid #dedfd2;border-top:4px solid #b7533a;border-radius:16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                  <tr>
                    <td class="email-content" style="padding:36px 40px;">
                      <p style="margin:0 0 16px;color:#354d42;font-size:11px;line-height:1.6;font-weight:bold;letter-spacing:1.6px;">${escapeHtml(copy.eyebrow)}</p>
                      <h1 class="email-title" style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:38px;font-weight:normal;line-height:1.16;letter-spacing:-1px;">${escapeHtml(copy.title)}<br><em style="color:#b7533a;font-weight:normal;">${escapeHtml(copy.accent)}</em></h1>
                      <p style="margin:0 0 28px;color:#61695f;font-size:13px;line-height:1.6;">${escapeHtml(t("COMMANDE"))} <strong style="color:#354d42;letter-spacing:1px;">${escapeHtml(reference)}</strong></p>
                      <p style="${paragraphStyle}">${escapeHtml(t("Bonjour,"))}</p>
                      ${copy.paragraphs.map(paragraph => `<p style="${paragraphStyle}">${escapeHtml(paragraph)}</p>`).join("\n                      ")}
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                        <tr>
                          <td style="padding:22px 24px;background-color:#edf0e4;border-radius:10px;">
                            <h2 style="margin:0 0 10px;color:#354d42;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:normal;line-height:1.3;">${escapeHtml(copy.detailTitle)}</h2>
                            <p style="margin:0;color:#354d42;font-size:15px;line-height:1.7;">${escapeHtml(copy.detail)}</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:26px 0;">
                            <a class="email-button" href="${escapeHtml(link)}" style="display:inline-block;background-color:#b7533a;border:1px solid #b7533a;border-radius:7px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;line-height:22px;padding:15px 24px;mso-padding-alt:0;">
                              <!--[if mso]><i style="mso-font-width:100%;mso-text-raise:24pt;" hidden>&emsp;</i><![endif]-->
                              <span style="mso-text-raise:12pt;">${escapeHtml(copy.action)}</span>
                              <!--[if mso]><i style="mso-font-width:100%;" hidden>&emsp;&#8203;</i><![endif]-->
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="${paragraphStyle}">${escapeHtml(copy.closing)}</p>
                      <p style="margin:24px 0 0;color:#354d42;font-size:15px;line-height:1.7;">${escapeHtml(signoff)}<br><strong>${escapeHtml(t("L’équipe « {0} »", t(SITE_NAME)))}</strong></p>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-content" style="padding:24px 40px;background-color:#f4e6d9;border-radius:0 0 16px 16px;">
                      <p style="margin:0;color:#354d42;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-style:italic;line-height:1.6;">${escapeHtml(tagline)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 12px 0;color:#61695f;font-size:13px;line-height:1.7;">
                <p style="margin:0 0 12px;">${escapeHtml(privacy)}</p>
                <p style="margin:0 0 12px;">${escapeHtml(t("Votre lien a expiré ?"))} <a href="${escapeHtml(renewalLink)}" style="color:#354d42;text-decoration:underline;">${escapeHtml(t("Demandez un nouveau lien de suivi"))}</a> ${escapeHtml(t("avec votre adresse e-mail et votre référence de commande."))}</p>
                <p style="margin:0;">${escapeHtml(t("Une question ?"))} <a href="${escapeHtml(questionsLink)}" style="color:#354d42;text-decoration:underline;">${escapeHtml(t("Consultez nos réponses"))}</a>.</p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
