/* Interface language only: changing language never touches artwork or seeds. */
(() => {
  'use strict';
  const messages={
    pt:{
      studio:'Estúdio tipográfico',language:'Idioma',composition:'Composição',effect:'Efeito',text:'Seu texto',font:'Fonte',
      typeColor:'Cor da tipografia',background:'Fundo',transparent:'Transparente',randomize:'Nova variação',
      advanced:'Ajustes avançados',size:'Tamanho da composição',expansion:'Expansão',expansionBlur:'Desfoque da expansão',
      deformationCount:'Quantidade de deformações',deformation:'Intensidade da deformação',blur:'Desfoque',
      contraction:'Contração',spread:'Dispersão dos fragmentos',regions:'Regiões de dissolução',dissolution:'Intensidade da dissolução',
      grainFade:'Dissolução granulada',grain:'Tamanho do grão',locateBlur:'Posicionar desfoque',locateDeform:'Posicionar deformações',
      locateDissolution:'Posicionar dissolução',locationHelp:'Arraste as elipses sobre a palavra para posicionar o efeito.',
      export:'Exportar',exportType:'Tipo de exportação',static:'Imagem',video:'Vídeo',downloadPNG:'Exportar PNG',
      pngHint:'2400 × 1350 px, com o fundo selecionado.',breathing:'Respiração',breathingHint:'A forma se expande e se contrai.',
      sway:'Balanço',swayHint:'Uma inclinação suave da composição.',drift:'Deslocamento',
      driftHeat:'As regiões de desfoque passeiam pela palavra.',driftCold:'As regiões de dissolução passeiam pela palavra.',
      intensity:'Intensidade',motionHint:'Combine os movimentos em um loop contínuo.',loopSummary:'Loop de {seconds} s. Combine os movimentos livremente.',
      duration:'Duração',exportSize:'Resolução',downloadMOV:'Exportar MOV',downloadGIF:'Exportar GIF',
      alphaHint:'MOV preserva a transparência suave. No GIF, a transparência é pontilhada.',
      workspace:'Área de trabalho',preview:'Prévia',previewLabel:'Prévia tipográfica · {mode}',canvasHint:'Tudo começa com uma palavra.',
      staticPreview:'Imagem estática',videoPreview:'Prévia do loop',done:'Concluir',
      regionOverlay:'Posicionar regiões do efeito',regionHint:'{count} regiões · Arraste ou use as setas · Esc para concluir',
      noRegions:'Nenhuma região. Aumente a quantidade ou o desfoque.',regionLabel:'Região {index} de {kind}. Arraste ou use as setas para mover.',
      kind_blur:'desfoque',kind_deform:'deformação',kind_dissolution:'dissolução',
      ready:'Pronto',playing:'Reproduzindo loop',positioning:'Posicionando regiões',positioningBusy:'Posicionando regiões…',
      enterText:'Digite um texto para começar.',rendering:'Atualizando…',preparingType:'Preparando tipografia…',
      preparingGrain:'Preparando textura…',preparingBreathing:'Preparando movimento…',loadingFonts:'Carregando fontes…',
      graphicsPaused:'Prévia pausada. Recarregue a página para continuar.',renderError:'Não foi possível renderizar. Tente alterar o texto ou um ajuste.',
      preparingLoop:'Preparando o loop…',exporting:'Exportando {format}…',exportProgress:'Exportando {format} · {percent}% · {frame}/{count} quadros',
      exportReady:'{format} pronto · {seconds} s · {width} × {height}',exportCancelled:'Exportação cancelada.',
      exportFailed:'Falha na exportação: {error}',cancelling:'Cancelando…',cancel:'Cancelar exportação',progress:'Progresso da exportação',
      graphicsNeeded:'Os movimentos de vídeo precisam da aceleração gráfica WebGL 2 neste navegador.',
      fontUnavailable:'Não foi possível carregar a fonte incorporada.',fontTimeout:'A fonte demorou demais para carregar. Recarregue a página.',
      textureUnavailable:'Textura indisponível. Extraia o ZIP completo e abra index.html.',textureTimeout:'A textura demorou demais para carregar. Recarregue a página.',
      graphicsLost:'A conexão com a placa gráfica foi interrompida. Recarregue a página.',graphicsFailed:'Falha no processamento gráfico.',
      pngFailed:'Não foi possível exportar o PNG.',frameFailed:'Não foi possível gerar um quadro do vídeo.',
      invalidVideo:'Dimensões ou duração de vídeo inválidas.',encodingFailed:'Não foi possível codificar um quadro do vídeo.',
      largeVideo:'O vídeo ultrapassa 1 GB. Escolha uma resolução menor ou uma duração mais curta.',
      incompleteVideo:'O vídeo está incompleto.',invalidGIF:'As dimensões de um quadro do GIF são inválidas.',
      largeGIF:'O GIF ultrapassa 500 MB. Escolha uma resolução menor ou uma duração mais curta.',incompleteGIF:'O GIF está incompleto.',
      missingAsset:'Um arquivo do app está faltando. Extraia todo o ZIP e mantenha a pasta assets ao lado de index.html.',
      startupError:'Não foi possível iniciar: {error}',startupFailed:'Não foi possível iniciar.',
      noScript:'Ative o JavaScript, extraia o ZIP e abra index.html no seu navegador.',
      color_1A1A1A:'Carvão',color_DAC4A3:'Areia',color_E6AE5E:'Dourado',color_B8C2A9:'Sálvia',
      color_C08040:'Ocre',color_F5EEE4:'Marfim',color_C93200:'Vermelho',color_555488:'Violeta'
    },
    en:{
      studio:'Type studio',language:'Language',composition:'Composition',effect:'Effect',text:'Your text',font:'Font',
      typeColor:'Type color',background:'Background',transparent:'Transparent',randomize:'Randomize',
      advanced:'Advanced controls',size:'Composition size',expansion:'Expansion',expansionBlur:'Expansion blur',
      deformationCount:'Deformation count',deformation:'Deformation intensity',blur:'Blur',
      contraction:'Contraction',spread:'Fragment spread',regions:'Dissolution regions',dissolution:'Dissolution intensity',
      grainFade:'Grainy fade',grain:'Grain size',locateBlur:'Locate blur',locateDeform:'Locate deformations',
      locateDissolution:'Locate dissolution',locationHelp:'Drag the ellipses over the word to position the effect.',
      export:'Export',exportType:'Export type',static:'Image',video:'Video',downloadPNG:'Export PNG',
      pngHint:'2400 × 1350 px, with the selected background.',breathing:'Breathing',breathingHint:'The form expands and contracts.',
      sway:'Sway',swayHint:'A gentle shear of the composition.',drift:'Drift',
      driftHeat:'Blur regions move over the word.',driftCold:'Dissolution regions move over the word.',
      intensity:'Intensity',motionHint:'Combine movements in one seamless loop.',loopSummary:'{seconds}-second loop. Combine movements freely.',
      duration:'Duration',exportSize:'Resolution',downloadMOV:'Export MOV',downloadGIF:'Export GIF',
      alphaHint:'MOV preserves soft transparency. GIF transparency is dithered.',
      workspace:'Workspace',preview:'Preview',previewLabel:'Typography preview · {mode}',canvasHint:'It starts with a word.',
      staticPreview:'Static image',videoPreview:'Loop preview',done:'Done',
      regionOverlay:'Position effect regions',regionHint:'{count} regions · Drag or use arrow keys · Esc to finish',
      noRegions:'No regions. Increase the region count or blur.',regionLabel:'{kind} region {index}. Drag or use arrow keys to move.',
      kind_blur:'Blur',kind_deform:'Deformation',kind_dissolution:'Dissolution',
      ready:'Ready',playing:'Playing loop',positioning:'Positioning regions',positioningBusy:'Positioning regions…',
      enterText:'Enter text to start.',rendering:'Updating…',preparingType:'Preparing type…',
      preparingGrain:'Preparing texture…',preparingBreathing:'Preparing motion…',loadingFonts:'Loading fonts…',
      graphicsPaused:'Preview paused. Reload to continue.',renderError:'Could not render. Try changing the text or a control.',
      preparingLoop:'Preparing loop…',exporting:'Exporting {format}…',exportProgress:'Exporting {format} · {percent}% · {frame}/{count} frames',
      exportReady:'{format} ready · {seconds}s · {width} × {height}',exportCancelled:'Export cancelled.',
      exportFailed:'Export failed: {error}',cancelling:'Cancelling…',cancel:'Cancel export',progress:'Export progress',
      graphicsNeeded:'Video movements need WebGL 2 graphics acceleration in this browser.',
      fontUnavailable:'The embedded font could not be loaded.',fontTimeout:'Font loading timed out. Reload this page.',
      textureUnavailable:'Texture unavailable. Extract the complete ZIP and open index.html.',textureTimeout:'Texture loading timed out. Reload this page.',
      graphicsLost:'Graphics context lost. Reload to restore the preview.',graphicsFailed:'Graphics processing failed.',
      pngFailed:'PNG export failed.',frameFailed:'PNG video frame failed.',
      invalidVideo:'Invalid video dimensions or duration.',encodingFailed:'A video frame could not be encoded.',
      largeVideo:'This loop exceeds 1 GB. Choose a smaller export size or a shorter duration.',
      incompleteVideo:'The video is incomplete.',invalidGIF:'Unexpected GIF frame dimensions.',
      largeGIF:'This GIF exceeds 500 MB. Choose a smaller export size or a shorter duration.',incompleteGIF:'The GIF is incomplete.',
      missingAsset:'An app file is missing. Extract the entire ZIP and keep the assets folder beside index.html.',
      startupError:'The app could not start: {error}',startupFailed:'Could not start.',
      noScript:'Enable JavaScript, extract the ZIP, and open index.html in your browser.',
      color_1A1A1A:'Charcoal',color_DAC4A3:'Sand',color_E6AE5E:'Gold',color_B8C2A9:'Sage',
      color_C08040:'Ochre',color_F5EEE4:'Ivory',color_C93200:'Red',color_555488:'Violet'
    }
  };
  let language='pt';
  const t=(key,values={})=>(messages[language][key]||messages.en[key]||key).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
  const errors={
    'Embedded font unavailable.':'fontUnavailable','Font loading timed out. Reload this page.':'fontTimeout',
    'Texture unavailable. Extract the complete ZIP and open index.html.':'textureUnavailable','Texture loading timed out. Reload this page.':'textureTimeout',
    'Graphics context lost. Reload to restore the preview.':'graphicsLost','Graphics processing failed.':'graphicsFailed',
    'PNG export failed.':'pngFailed','PNG video frame failed.':'frameFailed',
    'Invalid video dimensions or duration.':'invalidVideo','A video frame could not be encoded.':'encodingFailed',
    'This loop exceeds 1 GB. Choose a smaller export size or a shorter duration.':'largeVideo',
    'The video is incomplete.':'incompleteVideo','Unexpected GIF frame dimensions.':'invalidGIF',
    'This GIF exceeds 500 MB. Choose a smaller export size or a shorter duration.':'largeGIF','The GIF is incomplete.':'incompleteGIF'
  };
  function apply(root=document){
    root.documentElement.lang=language==='pt'?'pt-BR':'en';
    for(const [attribute,target]of [['data-i18n',null],['data-i18n-aria','aria-label'],['data-i18n-title','title']]){
      for(const node of root.querySelectorAll('['+attribute+']')){
        const value=t(node.getAttribute(attribute));if(target)node.setAttribute(target,value);else node.textContent=value;
      }
    }
    for(const code of ['pt','en'])root.getElementById('language'+code.toUpperCase())?.setAttribute('aria-pressed',String(code===language));
  }
  function setLanguage(value){language=value==='en'?'en':'pt';apply();window.dispatchEvent(new CustomEvent('mana:language'));}
  globalThis.ManaI18n={t,apply,setLanguage,get language(){return language;},error:e=>{const message=e?.message||String(e);return errors[message]?t(errors[message]):message;},messages};
})();
