/** Preview-only fit: keep authored slide dimensions and exported files intact. */
export const DECK_PREVIEW_INJECTION = `<style>
html[data-bg-deck-fit],html[data-bg-deck-fit]>body { min-width:0!important; min-height:0!important; width:100%!important; height:100%!important; margin:0!important; overflow:hidden!important; }
html[data-bg-deck-fit] [data-bg-slide-fit] {
  position:absolute!important; inset:0 auto auto 0!important; margin:0!important;
  transform:translate(var(--bg-slide-x),var(--bg-slide-y)) scale(var(--bg-slide-scale))!important;
  transform-origin:0 0!important;
}
</style><script data-bg-deck-preview-runtime>(function(){
  var pending=false, current=null, engaged=false;
  var slideResize=new ResizeObserver(schedule);
  function schedule(){if(!pending){pending=true;requestAnimationFrame(fit);}}
  function fit(){
    pending=false;
    var slide=document.querySelector("[data-slide][data-active]") || document.querySelector("[data-slide]");
    if(!slide)return;
    // Overflowing children (oversized placeholders) must fit too, so measure the scroll box.
    var width=Math.max(slide.offsetWidth,slide.scrollWidth);
    var height=Math.max(slide.offsetHeight,slide.scrollHeight);
    if(!width||!height||!innerWidth||!innerHeight)return;
    // Leave a deck that already fits exactly as authored.
    if(!engaged&&width<=innerWidth&&height<=innerHeight)return;
    if(slide!==current){
      if(current){current.removeAttribute("data-bg-slide-fit");current.style.removeProperty("--bg-slide-scale");current.style.removeProperty("--bg-slide-x");current.style.removeProperty("--bg-slide-y");}
      current=slide;
      slideResize.disconnect();slideResize.observe(slide);
    }
    engaged=true;
    document.documentElement.setAttribute("data-bg-deck-fit","");
    slide.setAttribute("data-bg-slide-fit","");
    var scale=Math.min(innerWidth/width,innerHeight/height,1);
    slide.style.setProperty("--bg-slide-scale",String(scale));
    slide.style.setProperty("--bg-slide-x",(innerWidth-width*scale)/2+"px");
    slide.style.setProperty("--bg-slide-y",(innerHeight-height*scale)/2+"px");
  }
  function install(){
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-active","data-deck-ready","class"]});
    new ResizeObserver(schedule).observe(document.body);
    window.addEventListener("resize",schedule);
    document.addEventListener("load",schedule,true);
    if(document.fonts)document.fonts.ready.then(schedule);
    schedule();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();<\/script>`;
