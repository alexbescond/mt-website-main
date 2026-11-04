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
function notificationCopy(kind: string, reference: string, position?: number, date?: string, deliveryMode: DeliveryMode = "weekly"): EmailCopy {
  if (kind === "shipped") {
    const sentOn = displayDate(date!);
    if (deliveryMode === "together") return {
      subject: `Vos cartes ont été expédiées — commande ${reference}`,
      preview: `Toutes vos cartes ont été expédiées ensemble le ${sentOn}.`,
      eyebrow: "CARTES EXPÉDIÉES",
      title: "Toutes vos cartes",
      accent: "sont en route.",
      paragraphs: [`Nous avons expédié toutes vos cartes dans un seul envoi le ${sentOn}, à l’adresse indiquée lors de votre commande. Le délai de réception dépend de l’acheminement postal.`],
      detailTitle: "Votre envoi groupé",
      detail: "Vous pourrez découvrir les cartes ensemble ou les offrir une à une, au rythme de votre enfant.",
      action: "Suivre mes cartes",
      closing: "Nous espérons qu’elles feront plaisir à votre enfant.",
    };
    return {
      subject: `Carte ${position} expédiée — commande ${reference}`,
      preview: `Expédiée le ${sentOn}, à l’adresse indiquée lors de votre commande.`,
      eyebrow: "CARTE EXPÉDIÉE",
      title: `La carte ${position}`,
      accent: "est en route.",
      paragraphs: [
        `Nous avons expédié la carte ${position} le ${sentOn}, à l’adresse indiquée lors de votre commande. Le délai de réception dépend désormais de l’acheminement postal.`,
      ],
      detailTitle: "Où en est votre commande ?",
      detail: "Votre page de suivi récapitule les cartes déjà expédiées et, s’il en reste à envoyer, la date prévue du prochain envoi.",
      action: "Suivre mes cartes",
      closing: "Nous espérons qu’elle fera plaisir à votre enfant.",
    };
  }

  if (kind === "access") {
    return {
      subject: `Votre lien de suivi — commande ${reference}`,
      preview: `Voici le lien demandé pour suivre votre commande. Il est valable ${TRACKING_LINK_DAYS} jours.`,
      eyebrow: "ACCÈS AU SUIVI",
      title: "Votre lien de suivi",
      accent: "est prêt.",
      paragraphs: [
        "Vous avez demandé à accéder au suivi de votre commande. Utilisez le lien ci-dessous : aucun compte n’est nécessaire.",
      ],
      detailTitle: "Ce que vous y trouverez",
      detail: "L’état de préparation de chaque carte, les dates d’expédition et, s’il reste des cartes à envoyer, la date prévue du prochain envoi.",
      action: "Accéder au suivi",
      closing: "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail : votre commande n’est pas modifiée.",
    };
  }

  return {
    subject: `Votre commande ${reference} est confirmée`,
    preview: "Commande confirmée : nous préparons les cartes et vous préviendrons à chaque expédition.",
    eyebrow: "COMMANDE CONFIRMÉE",
    title: "Merci pour votre commande.",
    accent: "Nous nous occupons du reste.",
    paragraphs: [
      "Votre commande est confirmée et enregistrée.",
      "Nous allons maintenant créer les cartes de votre enfant à partir de la photo que vous nous avez confiée et des aventures choisies. Chacune comportera une illustration et un message à son prénom.",
    ],
    detailTitle: "Les prochaines étapes",
    detail: deliveryMode === "together" ? "Nous préparons toutes vos cartes pour les expédier ensemble, dans un seul envoi. Vous recevrez un e-mail au moment de l’expédition ; le délai de réception dépend ensuite de l’acheminement postal." : `Nous commençons par préparer la première carte. Si vous en avez commandé plusieurs, les suivantes seront expédiées à ${SEND_INTERVAL_DAYS} jours d’intervalle. Vous recevrez un e-mail à chaque expédition ; le délai de réception dépend ensuite de l’acheminement postal.`,
    action: "Suivre mes cartes",
    closing: "Nous espérons que ces cartes deviendront de beaux souvenirs de famille.",
  };
}

// Use the site's paper, sage and terracotta palette, with email-safe system fonts.
// All essential content stays readable without images, external styles or web fonts.
export function notificationMessage(kind: string, reference: string, link: string, position?: number, date?: string, deliveryMode: DeliveryMode = "weekly") {
  const copy = notificationCopy(kind, reference, position, date, deliveryMode);
  const origin = new URL(link).origin;
  const renewalLink = origin + "/suivi";
  const questionsLink = origin + "/#questions";
  const privacy = `Ce lien est personnel et valable ${TRACKING_LINK_DAYS} jours. Gardez-le pour vous : il donne accès au suivi de votre commande.`;
  const renewal = "Votre lien a expiré ? Demandez-en un nouveau depuis la page de suivi, avec votre adresse e-mail et votre référence de commande.";
  const signoff = "À bientôt,";
  const tagline = "Des cartes à recevoir, à relire et à garder.";
  const paragraphStyle = "margin:0 0 18px;color:#354d42;font-size:16px;line-height:1.75";

  return {
    subject: copy.subject,
    text: [
      SITE_NAME,
      copy.title + " " + copy.accent,
      "Commande " + reference,
      "Bonjour,",
      ...copy.paragraphs,
      copy.detailTitle + "\n" + copy.detail,
      copy.action + " : " + link,
      copy.closing,
      signoff + "\nL’équipe « " + SITE_NAME + " »",
      privacy,
      renewal + "\n" + renewalLink,
      "Une question ? Consultez nos réponses : " + questionsLink,
      tagline,
    ].join("\n\n"),
    html: `<!doctype html>
<html lang="fr" dir="ltr">
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
    <div lang="fr" dir="ltr" aria-hidden="true" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(copy.preview)}</div>
    <table lang="fr" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#faf7f0;">
      <tr>
        <td class="email-shell" align="center" style="padding:36px 16px;">
          <!--[if mso]><table role="presentation" width="580" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:580px;">
            <tr>
              <td align="center" style="padding:0 12px 28px;">
                <a href="${escapeHtml(origin)}" style="color:#354d42;text-decoration:none;">
                  <span style="font-size:12px;line-height:1.8;letter-spacing:1px;">Les aventures de</span><br>
                  <span style="font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.4;">mon doudou <i style="color:#b7533a;">et</i> ma tétine</span>
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
                      <p style="margin:0 0 28px;color:#61695f;font-size:13px;line-height:1.6;">COMMANDE <strong style="color:#354d42;letter-spacing:1px;">${escapeHtml(reference)}</strong></p>
                      <p style="${paragraphStyle}">Bonjour,</p>
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
                      <p style="margin:24px 0 0;color:#354d42;font-size:15px;line-height:1.7;">${escapeHtml(signoff)}<br><strong>L’équipe « ${escapeHtml(SITE_NAME)} »</strong></p>
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
                <p style="margin:0 0 12px;">Votre lien a expiré ? <a href="${escapeHtml(renewalLink)}" style="color:#354d42;text-decoration:underline;">Demandez un nouveau lien de suivi</a> avec votre adresse e-mail et votre référence de commande.</p>
                <p style="margin:0;">Une question ? <a href="${escapeHtml(questionsLink)}" style="color:#354d42;text-decoration:underline;">Consultez nos réponses</a>.</p>
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
