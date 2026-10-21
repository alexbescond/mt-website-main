const dialog = document.querySelector<HTMLDialogElement>("#book-preview")!;
const tropical = [
  [
    "tetine-enregistrement",
    "Le grand départ",
    "La valise est prête",
    "Aujourd’hui, Tétine a une grande nouvelle : elle part en vacances ! Dans sa valise, elle a glissé un maillot de bain… et tous les beaux souvenirs de vos câlins.",
  ],
  [
    "tetine-avion",
    "Dans les nuages",
    "Le voyage commence",
    "Bien installée avec ses nouveaux amis, Tétine regarde les nuages. Elle est un peu impressionnée. Mais quelle aventure ! Elle a déjà hâte de tout te raconter.",
  ],
  [
    "tetine-ile",
    "Terre en vue",
    "Bonjour, le paradis !",
    "Par le hublot, une île apparaît. Du bleu, du vert, du sable tout doré. Tétine n’en croit pas ses yeux. « Regarde comme c’est beau ! » dit-elle à ses amis.",
  ],
  [
    "tetine-paddle",
    "Les pieds dans l’eau",
    "Un océan de découvertes",
    "Sur sa petite planche, Tétine avance doucement. Sous l’eau, des poissons rayés lui montrent le chemin. Elle pense à toi : tu aurais tellement aimé les voir !",
  ],
  [
    "tetine-plongee",
    "Sous la surface",
    "De nouveaux amis",
    "Un masque, des palmes… et plouf ! Les poissons viennent lui dire bonjour. Tétine découvre un jardin de coraux plein de couleurs.",
  ],
  [
    "tetine-hamac",
    "Une douce pensée",
    "À demain, mon petit grand",
    "Le soleil se couche. Bien au chaud dans son hamac, Tétine ferme les yeux. Elle est heureuse, et elle pense à toi. Demain, une nouvelle aventure l’attend. Toi aussi.",
  ],
];
const winter = [
  [
    "tetine-ski",
    "En route pour les sommets",
    "Les premières glissades",
    "Tétine a mis son bonnet et sa plus jolie écharpe. Devant elle, les montagnes brillent sous le soleil. Un petit pas, puis un autre : la voilà sur ses skis !",
  ],
  [
    "tetine-ski",
    "À chacun son rythme",
    "Une nouvelle aventure",
    "Tétine glisse tout doucement. Parfois elle tombe dans la neige, puis elle se relève. Ses amis l’encouragent. Comme toi, elle apprend de nouvelles choses chaque jour.",
  ],
];
let pages = tropical;
let current = 0;
function render() {
  const [file, chapter, title, text] = pages[current];
  const img = document.querySelector<HTMLImageElement>("#preview-image")!;
  img.src = `/images/${file}.webp`;
  img.alt = title;
  document.querySelector("#preview-chapter")!.textContent = chapter;
  document.querySelector("#preview-subtitle")!.textContent = title;
  document.querySelector("#preview-text")!.textContent = text;
  document.querySelector("#preview-counter")!.textContent =
    `${current + 1} / ${pages.length}`;
  document.querySelector<HTMLButtonElement>("#preview-prev")!.disabled =
    current === 0;
  document.querySelector<HTMLButtonElement>("#preview-next")!.disabled =
    current === pages.length - 1;
}
document
  .querySelectorAll<HTMLButtonElement>("[data-preview]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      const ski = button.dataset.preview === "ski";
      pages = ski ? winter : tropical;
      current = 0;
      document.querySelector("#preview-title")!.textContent = ski
        ? "Tétine va au ski"
        : "Tétine va sous les tropiques";
      document.querySelector<HTMLAnchorElement>("#preview-create")!.href =
        `/personnaliser?aventure=${ski ? "ski" : "tropiques"}`;
      render();
      dialog.showModal();
    }),
  );
document
  .querySelector("#close-preview")!
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
document.querySelector("#preview-prev")!.addEventListener("click", () => {
  if (current > 0) {
    current--;
    render();
  }
});
document.querySelector("#preview-next")!.addEventListener("click", () => {
  if (current < pages.length - 1) {
    current++;
    render();
  }
});
