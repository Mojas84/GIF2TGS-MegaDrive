declare module "lottie-web" {
  const lottie: {
    loadAnimation(options: {
      container: HTMLElement;
      renderer: "canvas" | "svg" | "html";
      loop: boolean;
      autoplay: boolean;
      animationData: unknown;
    }): { destroy(): void };
  };
  export default lottie;
}
