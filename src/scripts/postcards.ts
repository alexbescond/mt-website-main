import { adventures, isAdventureId } from "../lib/catalog";
const dialog = document.querySelector<HTMLDialogElement>("#postcard-preview")!;
const front = document.querySelector<HTMLElement>("#preview-front")!;
const back = document.querySelector<HTMLElement>("#preview-back")!;
const flip = document.querySelector<HTMLButtonElement>("#preview-flip")!;
function showBack(visible: boolean) {
  front.hidden = visible;
  back.hidden = !visible;
  flip.textContent = visible ? "Voir le recto" : "Voir le verso";
  document.querySelector("#preview-counter")!.textContent = visible ? "Verso · 2 / 2" : "Recto · 1 / 2";
}
document.querySelectorAll<HTMLButtonElement>("[data-preview]").forEach((button) => button.addEventListener("click", () => {
  const id = button.dataset.preview;
  if (!isAdventureId(id)) return;
  const item = adventures[id];
  document.querySelector("#preview-title")!.textContent = item.title;
  document.querySelector("#preview-front-title")!.textContent = item.title;
  document.querySelector<HTMLImageElement>("#preview-image")!.src = item.image;
  document.querySelector("#preview-text")!.textContent = id === "ski"
    ? "Aujourd’hui, j’ai fait mes premières traces dans la neige. Mes amis m’ont aidée à me relever, puis nous avons partagé un chocolat chaud. Je t’envoie un flocon de tendresse et je pense très fort à toi !"
    : "Le soleil me chatouille les pieds et la mer est toute bleue. J’ai trouvé un joli coquillage sur la plage. Je l’ai approché de mon oreille : on aurait dit qu’il me racontait une histoire ! Je pense très fort à toi.";
  document.querySelector<HTMLAnchorElement>("#preview-create")!.href = `/personnaliser?aventure=${id}`;
  showBack(false);
  dialog.showModal();
}));
flip.addEventListener("click", () => showBack(back.hidden));
document.querySelector("#close-preview")!.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
