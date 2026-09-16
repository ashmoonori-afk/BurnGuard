/** Preview-only fit: keep authored slide dimensions and exported files intact. */
export const DECK_PREVIEW_INJECTION = `<style>
html[data-bg-deck-fit],html[data-bg-deck-fit]>body { min-width:0!important; min-height:0!important; width:100%!important; height:100%!important; overflow:hidden!important; }
[data-bg-slide-fit] { position:fixed!important; inset:auto!important; margin:0!important; left:var(--bg-slide-x)!important; top:var(--bg-slide-y)!important; transform:scale(var(--bg-slide-scale))!important; transform-origin:0 0!important; }
</style><script data-bg-deck-preview-runtime>(function(){
  function fit(){
    var slide=document.querySelector('[data-slide][data-active]');
    if(!slide) return;
    var width=slide.offsetWidth,height=slide.offsetHeight;
    if(!width||!height) return;
    if(!slide.hasAttribute('data-bg-slide-fit')){
      var rect=slide.getBoundingClientRect();
      if(rect.width<=innerWidth+1&&rect.height<=innerHeight+1) return;
    }
    var scale=Math.min(innerWidth/width,innerHeight/height,1);
    document.documentElement.setAttribute('data-bg-deck-fit','');
    slide.setAttribute('data-bg-slide-fit','');
    slide.style.setProperty('--bg-slide-scale',String(scale));
    slide.style.setProperty('--bg-slide-x',(innerWidth-width*scale)/2+'px');
    slide.style.setProperty('--bg-slide-y',(innerHeight-height*scale)/2+'px');
  }
  function install(){
    var scheduled=false;
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(function(){scheduled=false;fit()})}}
    new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-active','data-deck-ready']});
    new ResizeObserver(schedule).observe(document.body);
    window.addEventListener('resize',schedule);
    document.fonts.ready.then(schedule);
    schedule();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();<\/script>`;
