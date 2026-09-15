/** Preview-only fitting: authored dimensions and exported files stay unchanged. */
export function buildDeckPreviewInjection(): string {
  return `<style data-bg-deck-preview-style>
html[data-bg-deck-preview] { width:100%!important; height:100%!important; overflow:hidden!important; }
html[data-bg-deck-preview] > body { margin:0!important; width:100%!important; height:100%!important; }
html[data-bg-deck-preview] [data-bg-deck-preview-slide] {
  position:absolute!important; inset:0 auto auto 0!important; margin:0!important;
  transform:translate(var(--bg-deck-preview-x),var(--bg-deck-preview-y)) scale(var(--bg-deck-preview-scale))!important;
  transform-origin:top left!important;
}
</style><script data-bg-deck-preview-runtime>(function(){
  var pending=false, current=null;
  var resize=new ResizeObserver(schedule);
  function schedule(){if(!pending){pending=true;requestAnimationFrame(fit);}}
  function fit(){
    pending=false;
    var slide=document.querySelector("[data-slide][data-active]") || document.querySelector("[data-slide]");
    if(!slide)return;
    if(slide!==current){
      if(current)current.removeAttribute("data-bg-deck-preview-slide");
      current=slide;
      slide.setAttribute("data-bg-deck-preview-slide","");
      resize.disconnect();resize.observe(slide);
    }
    var root=document.documentElement;
    root.setAttribute("data-bg-deck-preview","");
    var width=Math.max(slide.offsetWidth,slide.scrollWidth);
    var height=Math.max(slide.offsetHeight,slide.scrollHeight);
    if(!width || !height || !innerWidth || !innerHeight)return;
    var scale=Math.min(innerWidth/width,innerHeight/height,1);
    root.style.setProperty("--bg-deck-preview-scale",String(scale));
    root.style.setProperty("--bg-deck-preview-x",(innerWidth-width*scale)/2+"px");
    root.style.setProperty("--bg-deck-preview-y",(innerHeight-height*scale)/2+"px");
  }
  function install(){
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-active","style","class"]});
    window.addEventListener("resize",schedule);
    document.addEventListener("load",schedule,true);
    if(document.fonts)document.fonts.ready.then(schedule);
    schedule();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();<\/script>`;
}
